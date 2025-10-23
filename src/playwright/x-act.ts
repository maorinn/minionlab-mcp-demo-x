// Do not import Browser type directly; use type declarations
import { Browser, Locator, Page } from 'playwright';

/**
 * Get the first non-pinned tweet content by username and like it
 * @param username {string} Twitter username
 * @param browser {Browser} Browser instance
 * @param page {Page} Page instance
 * @returns {string} Tweet content
 */
export const xAct = async (
  username: string,
  browser: Browser,
  page: Page,
  replyText: string = 'LFG'
) => {
  await page.goto(`https://x.com/${username}`, {
    waitUntil: 'domcontentloaded',
    timeout: 1000 * 60,
  });

  // Wait for tweets to load
  await page.waitForSelector('article[data-testid="tweet"]', {
    timeout: 1000 * 60,
  });

  // Scroll slightly to load more content
  await simulateScroll(page, 2, 215);

  // Get all tweets
  const allTweets = await page.locator('article[data-testid="tweet"]').all();

  // Find the first non-pinned tweet
  let tweet;
  let content;

  for (const t of allTweets) {
    // Check whether this tweet has a "Pinned" badge
    const isPinned = (await t.locator('text=Pinned').count()) > 0;

    if (!isPinned) {
      // Found the first non-pinned tweet
      tweet = t;

      // Get the tweet content area
      const tweetTextElements = await tweet
        .locator('div[data-testid="tweetText"]')
        .all();
      if (tweetTextElements.length > 0) {
        content = tweetTextElements[0];
        break; // Found it, exit loop
      }
    }
  }

  // If no non-pinned tweet found, use the first tweet
  if (!tweet || !content) {
    tweet = allTweets[0];
    const tweetTextElements = await tweet
      .locator('div[data-testid="tweetText"]')
      .all();
    content = tweetTextElements[0];
  }

  // Wait 100-300ms
  // await new Promise((resolve) =>
  //   setTimeout(resolve, Math.random() * 100 + 100)
  // );

  // Enter the tweet - using a more reliable method
  await content.click({ force: true });

  // Wait for the tweet detail page to load
  await page.waitForSelector('article[data-testid="tweet"]');

  // Wait 100-300ms
  await new Promise((resolve) => setTimeout(resolve, Math.random() * 50 + 100));

  // Get tweet content - using a more precise selector
  const tweetContent = await page
    .locator('article[data-testid="tweet"]')
    .first()
    .locator('div[data-testid="tweetText"]')
    .first()
    .textContent();

  // // Use simulateScroll to scroll to bottom to reveal share button
  // // Gently scroll 2-3 times with varying distances to simulate human behavior
  // const scrollCount = 2 + Math.floor(Math.random() * 2); // 2-3次
  // const scrollDistance = 200 + Math.floor(Math.random() * 150); // 200-350像素
  // await simulateScroll(page, scrollCount, scrollDistance);

  // // Wait a random time after scrolling completes
  // await page.waitForTimeout(500 + Math.random() * 200);

  // // Like - using the correct selector
  // await safelyLikeTweet(tweet);

  // // Reply LFG - using the previously discussed approach
  // if (replyText != 'NO') {
  //   await replyLfg(page, replyText);
  // }
  // Return
  return tweetContent;
};

/**
 * Send a tweet
 * @param username {string} Twitter username
 * @param password {string} Twitter password
 * @param page {Page} Page instance
 * @param tweet {string} Tweet content
 */
export const sendTweet = async (
  username: string,
  password: string,
  page: Page,
  tweet: string
) => {
  // Clear https://x.com cookies
  await page.context().clearCookies({
    domain: 'x.com',
  });
  // Navigate to home
  await page.goto('https://x.com', {
    waitUntil: 'domcontentloaded',
    timeout: 1000 * 60,
  });
  // Check if already logged in
  const isLoggedIn = await checkIfLoggedIn(page);
  // Login if not logged in
  if (!isLoggedIn) {
    await loginToTwitter(page, username, password);
  }
  // Wait for page to stabilize
  await page.waitForTimeout(1000);

  // Wait for page to fully load
  await page
    .waitForSelector('[data-testid="tweetTextarea_0"]', { timeout: 10000 })
    .catch(() => {
      return page.reload({ waitUntil: 'domcontentloaded' });
    });
  const tweetTextarea = await page.locator('[data-testid="tweetTextarea_0"]');
  // Click into tweet input
  await tweetTextarea.click();

  // Wait for editor to become active
  await page.waitForTimeout(500);

  // Use faster input - set delay to 0 for quick typing
  await tweetTextarea.fill(tweet);

  // Wait to ensure text is input
  await page.waitForTimeout(500);

  // Check if the tag/typeahead selector appears
  const tagSelector = await page.locator('div[data-testid="typeaheadResult"]');
  if ((await tagSelector.count()) > 0) {
    // Click the first one
    await tagSelector.first().click();
    // Wait 100-300ms
    await page.waitForTimeout(100 + Math.random() * 100);
  }

  // Click send button
  await page.locator('[data-testid="tweetButtonInline"]').click();

  // Wait for sending to complete
  await page.waitForTimeout(2000);
};

/**
 * Check whether logged in to Twitter
 * @param page {Page} Page instance
 * @returns {Promise<boolean>} Whether logged in
 */
async function checkIfLoggedIn(page: Page): Promise<boolean> {
  // Wait for page load
  await page.waitForTimeout(2000);

  try {
    // Check if login button exists
    const loginButton = await page.locator('a[href="/login"]').count();
    if (loginButton > 0) {
      return false;
    }

    // Check for tweet button or profile element
    const tweetButton = await page
      .locator(
        '[data-testid="tweetButton"], [data-testid="SideNav_NewTweet_Button"]'
      )
      .count();
    const profileButton = await page
      .locator('[data-testid="AppTabBar_Profile_Link"]')
      .count();

    return tweetButton > 0 || profileButton > 0;
  } catch (error) {
    return false; // Assume not logged in on error
  }
}

/**
 * Log in to Twitter
 * @param page {Page} Page instance
 * @param username {string} Username
 * @param password {string} Password
 */
async function loginToTwitter(page: Page, username: string, password: string) {
  // Click Sign in button
  await page.locator('a[href="/login"]').click();

  // Wait for login form to load
  await page.waitForSelector('input[autocomplete="username"]', {
    timeout: 10000,
  });

  // Enter username
  await page.locator('input[autocomplete="username"]').fill(username);

  // Click Next using a more precise selector
  await clickButtonWithText(page, 'Next');

  // Handle potential extra verification steps
  await handleExtraVerification(page);

  // Wait for password input
  await page
    .waitForSelector('input[autocomplete="current-password"]', {
      timeout: 10000,
    })
    .catch(async () => {
      // Re-check whether extra verification is required
      await handleExtraVerification(page);
      // Wait for password input again
      await page.waitForSelector('input[autocomplete="current-password"]', {
        timeout: 10000,
      });
    });

  // Enter password
  await page.locator('input[autocomplete="current-password"]').fill(password);

  // Click Log in button
  await clickButtonWithText(page, 'Log in');

  // Wait for login to complete
  await page
    .waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 })
    .catch(() => {
      /* No navigation event after login, continue */
    });

  // Extra wait to ensure login completed
  await page.waitForTimeout(5000);

  // // Check if login succeeded
  // const isLoggedIn = await checkIfLoggedIn(page);
  // if (!isLoggedIn) {
  //   throw new Error('Login failed');
  // }
}

/**
 * Handle extra verification steps
 * @param page {Page} Page instance
 */
async function handleExtraVerification(page: Page) {
  try {
    // Check whether an extra verification page appears (by title text)
    const verificationTitle = await page
      .locator('text=Enter your phone number or username')
      .count();

    if (verificationTitle > 0) {
      // Get username from environment variable, default to jucatyo
      const verificationUsername = process.env.X_USERNAME || 'jucatyo';

      // Find the input field and enter the username
      const inputField = await page.locator('input').first();
      await inputField.fill(verificationUsername);

      // Click Next button
      await clickButtonWithText(page, 'Next');

      // Wait for processing to complete
      await page.waitForTimeout(2000);
    }
  } catch (error) {
    // Continue without interrupting the flow
  }
}

/**
 * Generic helper: click a button containing specific text
 * @param page {Page} Page instance
 * @param buttonText {string} Button text
 */
async function clickButtonWithText(page: Page, buttonText: string) {
  // Try multiple strategies to click the button
  await page
    .locator(`button[role="button"][type="button"]:has-text("${buttonText}")`)
    .click()
    .catch(async () => {
      await page
        .locator(`button:has-text("${buttonText}")`)
        .click()
        .catch(async () => {
          await page
            .locator(`text=${buttonText}`)
            .click({ force: true })
            .catch(async () => {
              // Find any element containing the specified text and click it
              await page.evaluate((text) => {
                const elements = Array.from(document.querySelectorAll('*'));
                const element = elements.find(
                  (el) => el.textContent && el.textContent.trim() === text
                );
                if (element) {
                  (element as HTMLElement).click();
                } else {
                  throw new Error(`Element with text "${text}" not found`);
                }
              }, buttonText);
            });
        });
    });
}

/**
 * Reply to a tweet
 * @param page {Page} Page instance
 * @param replyText {string} Reply content
 */
async function replyLfg(page: Page, replyText: string = 'LFG') {
  try {
    // Click the reply box to activate the editor
    await page.locator('.DraftEditor-editorContainer').click();

    // Wait for editor to become active
    await page.waitForTimeout(500);

    // Type text directly in the editor
    await page.keyboard.type(replyText, { delay: 0 });

    // Wait to ensure text is entered
    await page.waitForTimeout(200);

    // Click the send button
    const tweetButton = await page
      .locator('[data-testid="tweetButton"]')
      .first();
    await tweetButton.click();

    // Wait for sending to complete
    await page.waitForTimeout(1000);
  } catch (error) {
    // Fallback: use JavaScript to set the content directly
    try {
      await page.evaluate((text) => {
        const editorElement = document.querySelector(
          '[data-testid="tweetTextarea_0"]'
        );
        if (editorElement) {
          editorElement.textContent = text;
          // Trigger input event
          const event = new Event('input', { bubbles: true });
          editorElement.dispatchEvent(event);
        }
      }, replyText);

      // Attempt to click the send button
      await page
        .locator(
          '[data-testid="tweetButton"], [data-testid="tweetButtonInline"]'
        )
        .first()
        .click();
    } catch {
      // Ignore errors from fallback method
    }
  }
}

/**
 * Simulate scrolling
 * @param page {Page} Page instance
 * @param count {number} Number of scrolls
 * @param distance {number} Scroll distance
 */
async function simulateScroll(page: Page, count: number, distance: number) {
  for (let i = 0; i < count; i++) {
    await page.evaluate((scrollDistance) => {
      window.scrollBy(0, scrollDistance);
    }, distance);

    // Wait a small random time after each scroll
    await page.waitForTimeout(100 + Math.random() * 100);
  }
}

/**
 * Safely like a tweet
 * @param tweet {Locator} Tweet element
 */
async function safelyLikeTweet(tweet: any) {
  try {
    // Try to find the like button and click it
    const likeButton = tweet.locator('[data-testid="like"]');
    await likeButton.click();

    // Wait for like action to complete
    await new Promise((resolve) => setTimeout(resolve, 500));
  } catch {
    // Ignore errors when like fails
  }
}
