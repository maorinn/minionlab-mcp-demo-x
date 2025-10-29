//! MinionLab task attestation and reward accounting program.
//!
//! This Solana program allows the MinionLab coordinator to:
//! 1. Initialize a global network configuration.
//! 2. Register approved browser nodes (real user devices).
//! 3. Accept task submissions from those nodes, recording the work hash and reward weight.
//! 4. Settle rewards by decreasing pending balances once tokens are paid out off-chain.

use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    clock::Clock,
    entrypoint,
    entrypoint::ProgramResult,
    msg,
    program::{invoke_signed},
    program_error::ProgramError,
    pubkey::Pubkey,
    rent::Rent,
    system_instruction,
    sysvar::Sysvar,
};
use thiserror::Error;

/// PDA seed for the single network configuration account.
const CONFIG_SEED: &[u8] = b"config";
/// PDA seed prefix for per-node accounts.
const NODE_SEED: &[u8] = b"node";
/// PDA seed prefix for individual task submission records.
const TASK_SEED: &[u8] = b"task";

entrypoint!(process_instruction);

/// Program entrypoint.
pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    let instruction = MinionInstruction::try_from_slice(instruction_data)
        .map_err(|_| ProgramError::InvalidInstructionData)?;

    match instruction {
        MinionInstruction::InitNetwork { authority, reward_mint } => {
            process_init_network(program_id, accounts, authority, reward_mint)
        }
        MinionInstruction::RegisterNode => process_register_node(program_id, accounts),
        MinionInstruction::SubmitTask {
            task_hash,
            reward_units,
        } => process_submit_task(program_id, accounts, task_hash, reward_units),
        MinionInstruction::ClaimReward { amount } => {
            process_claim_reward(program_id, accounts, amount)
        }
    }
}

/// Instructions supported by the MinionLab program.
#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
pub enum MinionInstruction {
    /// Initialize the global configuration PDA.
    ///
    /// Accounts:
    /// 0. `[signer]` Payer + network authority.
    /// 1. `[writable]` Network config PDA.
    /// 2. `[]` System program.
    InitNetwork {
        /// Authority allowed to manage the network (usually MinionLab ops).
        authority: Pubkey,
        /// SPL token mint used for off-chain reward settlement.
        reward_mint: Pubkey,
    },

    /// Register a new node PDA under the authority.
    ///
    /// Accounts:
    /// 0. `[signer]` Network authority.
    /// 1. `[writable]` Network config PDA.
    /// 2. `[signer]` Node identity (browser device owner).
    /// 3. `[writable]` Node PDA.
    /// 4. `[]` System program.
    RegisterNode,

    /// Submit a task completion record.
    ///
    /// Accounts:
    /// 0. `[signer]` Node identity (must match registered node).
    /// 1. `[writable]` Node PDA.
    /// 2. `[writable]` Network config PDA.
    /// 3. `[writable]` Task record PDA (created).
    /// 4. `[]` System program.
    SubmitTask {
        /// Hash/fingerprint of the off-chain scraping task.
        task_hash: [u8; 32],
        /// Reward units the coordinator will settle for this task.
        reward_units: u64,
    },

    /// Mark a node's pending rewards as paid after off-chain settlement.
    ///
    /// Accounts:
    /// 0. `[signer]` Network authority.
    /// 1. `[writable]` Network config PDA.
    /// 2. `[writable]` Node PDA.
    ClaimReward {
        /// Amount of reward units to clear from the node's pending balance.
        amount: u64,
    },
}

/// Global network state.
#[derive(BorshSerialize, BorshDeserialize, Debug, Clone, PartialEq)]
pub struct NetworkConfig {
    pub authority: Pubkey,
    pub reward_mint: Pubkey,
    pub total_tasks: u64,
    pub total_reward_units: u64,
    pub bump: u8,
}

impl NetworkConfig {
    pub const LEN: usize = 32 + 32 + 8 + 8 + 1;
}

/// Registered node (browser agent) state.
#[derive(BorshSerialize, BorshDeserialize, Debug, Clone, PartialEq)]
pub struct NodeAccount {
    pub node_identity: Pubkey,
    pub authority: Pubkey,
    pub completed_tasks: u64,
    pub pending_reward_units: u64,
    pub total_reward_units: u64,
    pub bump: u8,
}

impl NodeAccount {
    pub const LEN: usize = 32 + 32 + 8 + 8 + 8 + 1;
}

/// Task submission record for audit.
#[derive(BorshSerialize, BorshDeserialize, Debug, Clone, PartialEq)]
pub struct TaskRecord {
    pub node_identity: Pubkey,
    pub task_hash: [u8; 32],
    pub reward_units: u64,
    pub submitted_at: i64,
    pub bump: u8,
}

impl TaskRecord {
    pub const LEN: usize = 32 + 32 + 8 + 8 + 1;
}

/// Program-specific errors.
#[derive(Error, Debug, Copy, Clone)]
pub enum MinionError {
    #[error("Unauthorized authority")]
    UnauthorizedAuthority,
    #[error("Node identity mismatch")]
    NodeIdentityMismatch,
    #[error("Insufficient pending rewards")]
    InsufficientPendingRewards,
    #[error("Account already initialized")]
    AccountAlreadyInitialized,
}

impl From<MinionError> for ProgramError {
    fn from(e: MinionError) -> Self {
        ProgramError::Custom(e as u32)
    }
}

fn process_init_network(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    authority: Pubkey,
    reward_mint: Pubkey,
) -> ProgramResult {
    let account_info_iter = &mut accounts.iter();
    let payer = next_account_info(account_info_iter)?;
    let config_account = next_account_info(account_info_iter)?;
    let system_program = next_account_info(account_info_iter)?;

    if !payer.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }

    if config_account.owner != program_id && !config_account.data_is_empty() {
        return Err(MinionError::AccountAlreadyInitialized.into());
    }

    if *system_program.key != system_program::id() {
        return Err(ProgramError::IncorrectProgramId);
    }

    let (expected_config_key, bump) = Pubkey::find_program_address(&[CONFIG_SEED], program_id);
    if expected_config_key != *config_account.key {
        msg!("Config PDA key mismatch");
        return Err(ProgramError::InvalidArgument);
    }

    let rent = Rent::get()?;
    let lamports = rent.minimum_balance(NetworkConfig::LEN);

    if config_account.data_is_empty() {
        let create_ix = system_instruction::create_account(
            payer.key,
            config_account.key,
            lamports,
            NetworkConfig::LEN as u64,
            program_id,
        );
        invoke_signed(
            &create_ix,
            &[payer.clone(), config_account.clone(), system_program.clone()],
            &[&[CONFIG_SEED, &[bump]]],
        )?;
    }

    let mut config_data = if config_account.owner == program_id && !config_account.data_is_empty()
    {
        NetworkConfig::try_from_slice(&config_account.data.borrow())
            .map_err(|_| ProgramError::InvalidAccountData)?
    } else {
        NetworkConfig {
            authority,
            reward_mint,
            total_tasks: 0,
            total_reward_units: 0,
            bump,
        }
    };
    config_data.authority = authority;
    config_data.reward_mint = reward_mint;
    config_data.bump = bump;

    config_data
        .serialize(&mut *config_account.data.borrow_mut())
        .map_err(|_| ProgramError::AccountDataTooSmall)
}

fn process_register_node(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    let account_info_iter = &mut accounts.iter();
    let authority_account = next_account_info(account_info_iter)?;
    let config_account = next_account_info(account_info_iter)?;
    let node_identity = next_account_info(account_info_iter)?;
    let node_pda = next_account_info(account_info_iter)?;
    let system_program = next_account_info(account_info_iter)?;

    if !authority_account.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    if !node_identity.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }

    let config = NetworkConfig::try_from_slice(&config_account.data.borrow())
        .map_err(|_| ProgramError::InvalidAccountData)?;
    if config.authority != *authority_account.key {
        return Err(MinionError::UnauthorizedAuthority.into());
    }
    if config_account.owner != program_id {
        return Err(ProgramError::IncorrectProgramId);
    }

    let (expected_config_key, _) = Pubkey::find_program_address(&[CONFIG_SEED], program_id);
    if expected_config_key != *config_account.key {
        msg!("Config account mismatch");
        return Err(ProgramError::InvalidArgument);
    }

    if !node_pda.data_is_empty() {
        return Err(MinionError::AccountAlreadyInitialized.into());
    }

    if *system_program.key != system_program::id() {
        return Err(ProgramError::IncorrectProgramId);
    }

    let (expected_node_pda, bump) =
        Pubkey::find_program_address(&[NODE_SEED, node_identity.key.as_ref()], program_id);
    if expected_node_pda != *node_pda.key {
        msg!("Node PDA mismatch");
        return Err(ProgramError::InvalidArgument);
    }

    let rent = Rent::get()?;
    let lamports = rent.minimum_balance(NodeAccount::LEN);

    let create_ix = system_instruction::create_account(
        authority_account.key,
        node_pda.key,
        lamports,
        NodeAccount::LEN as u64,
        program_id,
    );
    invoke_signed(
        &create_ix,
        &[
            authority_account.clone(),
            node_pda.clone(),
            system_program.clone(),
        ],
        &[&[NODE_SEED, node_identity.key.as_ref(), &[bump]]],
    )?;

    let node_state = NodeAccount {
        node_identity: *node_identity.key,
        authority: config.authority,
        completed_tasks: 0,
        pending_reward_units: 0,
        total_reward_units: 0,
        bump,
    };

    node_state
        .serialize(&mut *node_pda.data.borrow_mut())
        .map_err(|_| ProgramError::AccountDataTooSmall)
}

fn process_submit_task(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    task_hash: [u8; 32],
    reward_units: u64,
) -> ProgramResult {
    let account_info_iter = &mut accounts.iter();
    let node_identity = next_account_info(account_info_iter)?;
    let node_pda = next_account_info(account_info_iter)?;
    let config_account = next_account_info(account_info_iter)?;
    let task_pda = next_account_info(account_info_iter)?;
    let system_program = next_account_info(account_info_iter)?;

    if !node_identity.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }

    if reward_units == 0 {
        msg!("Reward units must be greater than zero");
        return Err(ProgramError::InvalidInstructionData);
    }

    let mut node_state = NodeAccount::try_from_slice(&node_pda.data.borrow())
        .map_err(|_| ProgramError::InvalidAccountData)?;
    if node_state.node_identity != *node_identity.key {
        return Err(MinionError::NodeIdentityMismatch.into());
    }
    if node_pda.owner != program_id || config_account.owner != program_id {
        return Err(ProgramError::IncorrectProgramId);
    }

    let mut config_state = NetworkConfig::try_from_slice(&config_account.data.borrow())
        .map_err(|_| ProgramError::InvalidAccountData)?;

    let (expected_node_pda, node_bump) =
        Pubkey::find_program_address(&[NODE_SEED, node_identity.key.as_ref()], program_id);
    if expected_node_pda != *node_pda.key || node_bump != node_state.bump {
        msg!("Node PDA seeds mismatch");
        return Err(ProgramError::InvalidArgument);
    }

    let (expected_config_key, _) = Pubkey::find_program_address(&[CONFIG_SEED], program_id);
    if expected_config_key != *config_account.key {
        msg!("Config PDA mismatch");
        return Err(ProgramError::InvalidArgument);
    }

    if !task_pda.data_is_empty() {
        return Err(MinionError::AccountAlreadyInitialized.into());
    }

    let (expected_task_pda, bump) = Pubkey::find_program_address(
        &[TASK_SEED, node_identity.key.as_ref(), &task_hash],
        program_id,
    );
    if expected_task_pda != *task_pda.key {
        msg!("Task PDA mismatch");
        return Err(ProgramError::InvalidArgument);
    }

    if *system_program.key != system_program::id() {
        return Err(ProgramError::IncorrectProgramId);
    }

    let rent = Rent::get()?;
    let lamports = rent.minimum_balance(TaskRecord::LEN);
    let create_ix = system_instruction::create_account(
        node_identity.key,
        task_pda.key,
        lamports,
        TaskRecord::LEN as u64,
        program_id,
    );

    invoke_signed(
        &create_ix,
        &[
            node_identity.clone(),
            task_pda.clone(),
            system_program.clone(),
        ],
        &[&[TASK_SEED, node_identity.key.as_ref(), &task_hash, &[bump]]],
    )?;

    let now = Clock::get()?.unix_timestamp;
    let task_record = TaskRecord {
        node_identity: *node_identity.key,
        task_hash,
        reward_units,
        submitted_at: now,
        bump,
    };
    task_record
        .serialize(&mut *task_pda.data.borrow_mut())
        .map_err(|_| ProgramError::AccountDataTooSmall)?;

    node_state.completed_tasks = node_state
        .completed_tasks
        .checked_add(1)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    node_state.pending_reward_units = node_state
        .pending_reward_units
        .checked_add(reward_units)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    node_state.total_reward_units = node_state
        .total_reward_units
        .checked_add(reward_units)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    node_state
        .serialize(&mut *node_pda.data.borrow_mut())
        .map_err(|_| ProgramError::AccountDataTooSmall)?;

    config_state.total_tasks = config_state
        .total_tasks
        .checked_add(1)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    config_state.total_reward_units = config_state
        .total_reward_units
        .checked_add(reward_units)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    config_state
        .serialize(&mut *config_account.data.borrow_mut())
        .map_err(|_| ProgramError::AccountDataTooSmall)?;

    Ok(())
}

fn process_claim_reward(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    amount: u64,
) -> ProgramResult {
    let account_info_iter = &mut accounts.iter();
    let authority_account = next_account_info(account_info_iter)?;
    let config_account = next_account_info(account_info_iter)?;
    let node_pda = next_account_info(account_info_iter)?;

    if !authority_account.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }

    let config_state = NetworkConfig::try_from_slice(&config_account.data.borrow())
        .map_err(|_| ProgramError::InvalidAccountData)?;
    if config_state.authority != *authority_account.key {
        return Err(MinionError::UnauthorizedAuthority.into());
    }
    if config_account.owner != program_id || node_pda.owner != program_id {
        return Err(ProgramError::IncorrectProgramId);
    }

    let (expected_config_key, _) = Pubkey::find_program_address(&[CONFIG_SEED], program_id);
    if expected_config_key != *config_account.key {
        msg!("Config PDA mismatch");
        return Err(ProgramError::InvalidArgument);
    }

    let mut node_state = NodeAccount::try_from_slice(&node_pda.data.borrow())
        .map_err(|_| ProgramError::InvalidAccountData)?;
    let (expected_node_pda, _) =
        Pubkey::find_program_address(&[NODE_SEED, node_state.node_identity.as_ref()], program_id);
    if expected_node_pda != *node_pda.key {
        msg!("Node PDA mismatch");
        return Err(ProgramError::InvalidArgument);
    }

    if amount > node_state.pending_reward_units {
        return Err(MinionError::InsufficientPendingRewards.into());
    }

    node_state.pending_reward_units = node_state
        .pending_reward_units
        .checked_sub(amount)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    node_state
        .serialize(&mut *node_pda.data.borrow_mut())
        .map_err(|_| ProgramError::AccountDataTooSmall)?;

    Ok(())
}
