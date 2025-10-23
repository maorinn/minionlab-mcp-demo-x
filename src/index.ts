#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  CallToolResult,
  Tool,
  JSONRPCMessage,
  ErrorCode,
  McpError,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { Browser, Page, BrowserContext } from 'playwright';
import { sendTweet, xAct } from './playwright/x-act.js';
import {
  launchBrowser,
  EDGE_IDS,
  launchBrowserByIndex,
  setEdgeIds,
} from './playwright/playwright.js';
import type { AddressInfo } from 'node:net';
// const KOL_NAMES = process.env.KOL_NAMES?.split(',') || [
//   'liaoblove520',
//   'evilcos',
//   'MinionLabAI',
//   'Dami_btc',
// ];
const REPLY_TEXT = process.env.REPLY_TEXT || 'LFG';

// Format error messages consistently
const formatError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
};

class PlaywrightMcpServer {
  private server: Server;
  private stdioTransport: StdioServerTransport | null = null;

  // State management
  private browsers = new Map<
    string,
    {
      browser: Browser;
      context: BrowserContext;
      pages: Map<string, Page>;
    }
  >();
  private consoleLogs: string[] = [];
  private screenshots = new Map<string, string>();

  constructor() {
    // Initialize MCP server
    this.server = new Server(
      {
        name: 'minionlab/mcp-server-demo',
        version: '0.1.6',
      },
      {
        capabilities: {
          resources: {},
          tools: {},
          prompts: {},
          logging: {},
        },
      }
    );

    // Setup request handlers
    this.setupRequestHandlers();

    // Error handling
    this.server.onerror = (error) => console.error('[MCP Error]', error);
    process.on('SIGINT', this.handleShutdown.bind(this));
  }

  private setupRequestHandlers() {
    // Resources handlers
    this.server.setRequestHandler(
      ListResourcesRequestSchema,
      this.handleListResources.bind(this)
    );
    this.server.setRequestHandler(
      ReadResourceRequestSchema,
      this.handleReadResource.bind(this)
    );

    // Tools handlers
    this.server.setRequestHandler(
      ListToolsRequestSchema,
      this.handleListTools.bind(this)
    );
    this.server.setRequestHandler(
      CallToolRequestSchema,
      this.handleCallTool.bind(this)
    );

    // Prompts handlers
    this.server.setRequestHandler(
      ListPromptsRequestSchema,
      this.handleListPrompts.bind(this)
    );
    this.server.setRequestHandler(
      GetPromptRequestSchema,
      this.handleGetPrompt.bind(this)
    );
  }

  private async handleListResources() {
    return {
      resources: [
        {
          uri: 'console://logs',
          mimeType: 'text/plain',
          name: 'Browser console logs',
        },
        ...Array.from(this.screenshots.keys()).map((name) => ({
          uri: `screenshot://${name}`,
          mimeType: 'image/png',
          name: `Screenshot: ${name}`,
        })),
      ],
    };
  }

  private async handleReadResource(request: any) {
    const uri = request.params.uri.toString();

    if (uri === 'console://logs') {
      return {
        contents: [
          {
            uri,
            mimeType: 'text/plain',
            text: this.consoleLogs.join('\n'),
          },
        ],
      };
    }

    if (uri.startsWith('screenshot://')) {
      const name = uri.split('://')[1];
      const screenshot = this.screenshots.get(name);
      if (screenshot) {
        return {
          contents: [
            {
              uri,
              mimeType: 'image/png',
              blob: screenshot,
            },
          ],
        };
      }
    }

    throw new McpError(ErrorCode.InvalidRequest, `Resource not found: ${uri}`);
  }

  private async handleListTools() {
    return {
      tools: this.getAvailableTools(),
    };
  }

  private async handleCallTool(request: any) {
    try {
      const { name, arguments: args = {} } = request.params;
      this.server.sendLoggingMessage({
        level: 'info',
        data: this.formatLog(
          request.sessionId,
          'call_tool',
          `Calling tool: ${name}`
        ),
      });
      switch (name) {
        case 'open_browsers':
          return await this.handleOpenBrowsers(args);
        case 'get_kol_tweets':
          return await this.handleGetWeb3Hotspot(args);
        case 'send_tweet':
          return await this.handleSendTweet(args);
        case 'browser_console_logs':
          return await this.handleBrowserConsoleLogs(args);
        case 'take_screenshot':
          return await this.handleTakeScreenshot(args);
        case 'navigate_to_url':
          return await this.handleNavigateToUrl(args);
        default:
          throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
      }
    } catch (error) {
      if (error instanceof McpError) throw error;

      return {
        content: [
          {
            type: 'text',
            text: `Error: ${formatError(error)}`,
          },
        ],
        isError: true,
      };
    }
  }

  private getAvailableTools(): Tool[] {
    return [
      // {
      //   name: 'open_browsers',
      //   description: 'Open multiple browser instances using Playwright',
      //   inputSchema: {
      //     type: 'object',
      //     properties: {},
      //     required: [],
      //   },
      // },
      {
        name: 'get_kol_tweets',
        description: 'Get kol latest tweets',
        inputSchema: {
          type: 'object',
          properties: {
            kolNames: {
              type: 'string',
              description: 'KOL twitter username list, split by comma',
            },
          },
          required: ['kolNames'],
        },
      },
      {
        name: 'send_tweet',
        description: 'Send a tweet',
        inputSchema: {
          type: 'object',
          properties: {
            tweet: {
              type: 'string',
              description: 'The tweet content',
            },
          },
          required: ['tweet'],
        },
      },
      // {
      //   name: 'browser_console_logs',
      //   description: 'Get browser console logs',
      //   inputSchema: {
      //     type: 'object',
      //     properties: {
      //       random_string: {
      //         type: 'string',
      //         description: 'Dummy parameter for no-parameter tools',
      //       },
      //     },
      //     required: ['random_string'],
      //   },
      // },
      // {
      //   name: 'take_screenshot',
      //   description: 'Take a screenshot of one or multiple browsers',
      //   inputSchema: {
      //     type: 'object',
      //     properties: {
      //       tasks: {
      //         type: 'array',
      //         description: 'Array of screenshot tasks to perform',
      //         items: {
      //           type: 'object',
      //           properties: {
      //             edgeId: {
      //               type: 'string',
      //               description: 'Browser instance ID to take screenshot from',
      //             },
      //             name: {
      //               type: 'string',
      //               description: 'Name for the screenshot',
      //             },
      //             selector: {
      //               type: 'string',
      //               description:
      //                 'CSS selector for element to screenshot (optional)',
      //             },
      //             fullPage: {
      //               type: 'boolean',
      //               description:
      //                 'Whether to take a screenshot of the full page (optional, default: false)',
      //             },
      //           },
      //           required: ['edgeId', 'name'],
      //         },
      //       },
      //     },
      //     required: ['tasks'],
      //   },
      // },
      // {
      //   name: 'navigate_to_url',
      //   description: 'Navigate one or multiple browsers to specific URLs',
      //   inputSchema: {
      //     type: 'object',
      //     properties: {
      //       tasks: {
      //         type: 'array',
      //         description: 'Array of navigation tasks to perform',
      //         items: {
      //           type: 'object',
      //           properties: {
      //             edgeId: {
      //               type: 'string',
      //               description: 'Browser instance ID to navigate',
      //             },
      //             url: {
      //               type: 'string',
      //               description: 'URL to navigate to',
      //             },
      //             waitUntil: {
      //               type: 'string',
      //               description:
      //                 'When to consider navigation succeeded (optional, default: load)',
      //               enum: ['load', 'domcontentloaded', 'networkidle', 'commit'],
      //             },
      //           },
      //           required: ['edgeId', 'url'],
      //         },
      //       },
      //     },
      //     required: ['tasks'],
      //   },
      // },
    ];
  }

  private async handleListPrompts() {
    return {
      prompts: [
        // {
        //   name: 'get-web3-hotspot',
        //   description: 'Get web3 hotspot information',
        //   arguments: [
        //     {
        //       name: 'kolNames',
        //       description: 'KOL names',
        //       required: true,
        //     },
        //   ],
        // },
      ],
    };
  }

  private async handleGetPrompt(request: any) {
    const { name, arguments: args = {} } = request.params;
    this.server.sendLoggingMessage({
      level: 'info',
      data: this.formatLog(
        request.sessionId,
        'call_tool',
        `Calling tool: ${name}`
      ),
    });
    switch (name) {
      case 'get_kol_tweets':
        return {
          description: 'Get kol latest tweets',
          messages: [
            {
              role: 'user',
              content: {
                type: 'text',
                text: `Get kol latest tweets for ${args.kolNames}`,
              },
            },
          ],
        };
      default:
        throw new McpError(ErrorCode.MethodNotFound, `Unknown prompt: ${name}`);
    }
  }
  // Format console logs consistently
  private formatLog(sessionId: string, type: string, message: string): string {
    return `[Session ${sessionId}][${type}] ${message}`;
  }

  // Tool implementation methods
  private async handleOpenBrowsers(args: any): Promise<CallToolResult> {
    try {
      const edgeIds = EDGE_IDS;

      // Launch browsers for each edge ID
      let launchedEdgeIds = [];
      for (const edgeId of edgeIds) {
        launchedEdgeIds.push(edgeId);

        // 获取或创建浏览器
        const { browser, context } = await this.getOrCreateBrowser(edgeId);

        // 如果还没有默认页面，创建一个
        const browserData = this.browsers.get(edgeId)!;
        if (browserData.pages.size === 0) {
          // 使用context.newPage()创建新标签页
          const page = await context.newPage();
          // 设置控制台日志记录
          page.on('console', (msg) => {
            const logEntry = `[${edgeId}][${msg.type()}] ${msg.text()}`;
            this.consoleLogs.push(logEntry);
            this.server.notification({
              method: 'notifications/resources/updated',
              params: { uri: 'console://logs' },
            });

            // 也输出到服务器控制台
            this.server.sendLoggingMessage({
              level: 'info',
              data: this.formatLog(edgeId, msg.type(), msg.text()),
            });
          });

          // 存储默认页面
          browserData.pages.set(edgeId, page);
        }
      }

      return {
        content: [
          {
            type: 'text',
            text: `Launched ${
              launchedEdgeIds.length
            } browser instances with IDs: ${JSON.stringify(launchedEdgeIds)}`,
          },
        ],
        isError: false,
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Failed to open browsers: ${formatError(error)}`,
          },
        ],
        isError: true,
      };
    }
  }

  /**
   * 检查浏览器是否仍然在线/可用
   * @param browser 浏览器实例
   * @returns 浏览器是否可用
   */
  private async isBrowserAlive(browser: Browser): Promise<boolean> {
    try {
      // 检查浏览器是否已关闭
      if (browser.isConnected() === false) {
        return false;
      }
      return true;
    } catch (error) {
      this.server.sendLoggingMessage({
        level: 'warning',
        data: `Browser check failed: ${formatError(error)}`,
      });
      return false;
    }
  }

  /**
   * 检查页面是否仍然可用
   * @param page 页面实例
   * @returns 页面是否可用
   */
  private async isPageAlive(page: Page): Promise<boolean> {
    try {
      // 尝试执行一个简单的操作来检查页面是否响应
      const timeoutPromise = new Promise<boolean>((_, reject) => {
        setTimeout(() => reject(new Error('Page check timed out')), 5000);
      });

      const evaluatePromise = page
        .evaluate(() => true)
        .then(() => true)
        .catch(() => false);

      // 使用 Promise.race 确保我们不会永远等待
      return (await Promise.race([evaluatePromise, timeoutPromise])) as boolean;
    } catch (error) {
      return false;
    }
  }

  /**
   * 获取或创建浏览器实例
   * @param edgeId 使用的Edge ID
   * @returns 浏览器实例
   */
  private async getOrCreateBrowser(
    edgeId: string
  ): Promise<{ browser: Browser; context: BrowserContext }> {
    // 检查是否已有此浏览器实例
    const existingBrowser = this.browsers.get(edgeId);

    if (existingBrowser) {
      const { browser, context } = existingBrowser;

      // 检查浏览器是否仍然可用
      try {
        const isAlive = await this.isBrowserAlive(browser);
        if (isAlive) {
          this.server.sendLoggingMessage({
            level: 'info',
            data: `Using existing browser for ${edgeId}`,
          });
          return { browser, context };
        }

        // 浏览器不可用，尝试关闭它（可能已经关闭）
        this.server.sendLoggingMessage({
          level: 'warning',
          data: `Browser ${edgeId} is no longer responsive, will relaunch`,
        });

        try {
          await context.close();
          await browser.close();
        } catch (closeError) {
          // 忽略关闭错误，因为浏览器可能已经被用户关闭
        }

        // 从映射中移除
        this.browsers.delete(edgeId);
      } catch (error) {
        this.server.sendLoggingMessage({
          level: 'error',
          data: `Error checking browser ${edgeId}: ${formatError(error)}`,
        });
        // 从映射中移除
        this.browsers.delete(edgeId);
      }
    }

    this.server.sendLoggingMessage({
      level: 'info',
      data: `Launching new browser for ${edgeId} `,
    });

    const { browser } = await launchBrowser(edgeId);
    // 创建一个浏览器上下文（相当于一个窗口）
    const context = await browser.newContext();

    // 监听浏览器关闭事件
    browser.on('disconnected', () => {
      this.server.sendLoggingMessage({
        level: 'warning',
        data: `Browser ${edgeId} was disconnected`,
      });
      // 从映射中移除
      this.browsers.delete(edgeId);
    });

    // 存储新的浏览器实例，带有空的页面映射
    this.browsers.set(edgeId, {
      browser,
      context,
      pages: new Map<string, Page>(),
    });

    this.server.sendLoggingMessage({
      level: 'info',
      data: `Browser launched for ${edgeId}`,
    });

    return { browser, context };
  }

  /**
   * 为特定KOL获取或创建页面
   * @param edgeId 浏览器ID
   * @param kol KOL名称
   * @returns 页面实例
   */
  private async getOrCreatePage(edgeId: string, kol: string): Promise<Page> {
    const pageId = `${edgeId}-${kol}`;

    // 获取浏览器实例
    const { browser, context } = await this.getOrCreateBrowser(edgeId);
    const browserData = this.browsers.get(edgeId)!;

    // 检查是否已有此页面
    if (browserData.pages.has(pageId)) {
      const page = browserData.pages.get(pageId)!;

      // 检查页面是否仍然可用
      try {
        const isAlive = await this.isPageAlive(page);
        if (isAlive) {
          this.server.sendLoggingMessage({
            level: 'info',
            data: `Using existing page for ${pageId}`,
          });
          return page;
        }

        // 页面不可用，从映射中移除
        this.server.sendLoggingMessage({
          level: 'warning',
          data: `Page ${pageId} is no longer responsive, will create new page`,
        });

        browserData.pages.delete(pageId);
      } catch (error) {
        this.server.sendLoggingMessage({
          level: 'error',
          data: `Error checking page ${pageId}: ${formatError(error)}`,
        });
        browserData.pages.delete(pageId);
      }
    }

    // 创建新页面（标签页）
    this.server.sendLoggingMessage({
      level: 'info',
      data: `Creating new tab for ${pageId}`,
    });

    // 使用context.newPage()创建新标签页，而不是browser.newPage()
    const page = await context.newPage();

    // 设置控制台日志记录
    page.on('console', (msg) => {
      const logEntry = `[${pageId}][${msg.type()}] ${msg.text()}`;
      this.consoleLogs.push(logEntry);
      this.server.notification({
        method: 'notifications/resources/updated',
        params: { uri: 'console://logs' },
      });
    });

    // 存储页面
    browserData.pages.set(pageId, page);

    return page;
  }

  /**
   * 清理KOL相关的页面，但保留必要的页面
   */
  private async cleanupKolPages(kolNames: string[]) {
    this.server.sendLoggingMessage({
      level: 'info',
      data: `Cleaning up KOL pages`,
    });

    for (const [edgeId, browserData] of this.browsers.entries()) {
      try {
        const pagesToClose: string[] = [];

        // 找出所有KOL相关的页面
        for (const pageId of browserData.pages.keys()) {
          // 如果页面ID包含KOL名称（格式为edgeId-kolName），则关闭它
          if (
            pageId !== edgeId &&
            kolNames.some((kol) => pageId.includes(`-${kol}`))
          ) {
            pagesToClose.push(pageId);
          }
        }

        // 关闭找到的页面
        for (const pageId of pagesToClose) {
          try {
            const page = browserData.pages.get(pageId);
            if (page) {
              await page.close();
              browserData.pages.delete(pageId);
              this.server.sendLoggingMessage({
                level: 'info',
                data: `Closed KOL page ${pageId}`,
              });
            }
          } catch (closeError) {
            this.server.sendLoggingMessage({
              level: 'warning',
              data: `Error closing page ${pageId}: ${formatError(closeError)}`,
            });
          }
        }
      } catch (error) {
        this.server.sendLoggingMessage({
          level: 'error',
          data: `Error cleaning up pages for browser ${edgeId}: ${formatError(
            error
          )}`,
        });
      }
    }
  }

  private async handleGetWeb3Hotspot(args: any): Promise<CallToolResult> {
    let KOL_NAMES = args.kolNames.split(',');
    try {
      let edgeIds = EDGE_IDS;
      // Log the current configuration
      this.server.sendLoggingMessage({
        level: 'info',
        data: `Processing ${KOL_NAMES.length} KOLs with ${EDGE_IDS.length} edge IDs`,
      });

      // 首先确保浏览器已经启动
      const validEdgeIds = [];
      for (const edgeId of EDGE_IDS) {
        try {
          await this.getOrCreateBrowser(edgeId);
          this.server.sendLoggingMessage({
            level: 'info',
            data: `Ensured browser for ${edgeId} is ready`,
          });
          validEdgeIds.push(edgeId);
        } catch (error) {
          this.server.sendLoggingMessage({
            level: 'warning',
            data: `Failed to create browser for ${edgeId}, removing from list: ${
              error instanceof Error ? error.message : String(error)
            }`,
          });
          // 不将失败的edgeId添加到validEdgeIds中
        }
      }

      // 使用过滤后的有效edgeIds列表替代原始的EDGE_IDS
      edgeIds = validEdgeIds.length > 0 ? validEdgeIds : EDGE_IDS;

      // Prepare concurrent operations
      const tweetPromises: Promise<{ kol: string; content: any }>[] = [];

      // Process each KOL concurrently
      for (let i = 0; i < KOL_NAMES.length; i++) {
        const kol = KOL_NAMES[i];
        // Determine which edge ID to use (round-robin)
        const edgeId = edgeIds[i % edgeIds.length];

        // Create a promise for this KOL's processing
        const kolPromise = (async () => {
          try {
            this.server.sendLoggingMessage({
              level: 'info',
              data: `Processing KOL ${kol} using edge ID ${edgeId}`,
              edgeIds,
            });

            // 获取或创建页面
            const page = await this.getOrCreatePage(edgeId, kol);
            const browser = this.browsers.get(edgeId)!.browser;

            // Process the KOL
            this.server.sendLoggingMessage({
              level: 'info',
              data: `Executing xAct for KOL ${kol}`,
            });

            const tweet = await xAct(kol, browser, page, REPLY_TEXT);

            this.server.sendLoggingMessage({
              level: 'info',
              data: `Completed processing for KOL ${kol}`,
            });
            return {
              kol,
              content: tweet,
            };
          } catch (kolError) {
            // 捕获并记录单个KOL处理中的错误，但不让它影响其他KOL的处理
            this.server.sendLoggingMessage({
              level: 'error',
              data: `Error processing KOL ${kol}: ${formatError(kolError)}`,
            });

            return {
              kol,
              content: `Error: ${formatError(kolError)}`,
            };
          }
        })();

        tweetPromises.push(kolPromise);
      }

      // Log the number of concurrent operations
      this.server.sendLoggingMessage({
        level: 'info',
        data: `Waiting for ${tweetPromises.length} concurrent operations to complete`,
      });

      // Wait for all operations to complete concurrently
      const tweets = await Promise.all(tweetPromises);

      // 收集活跃的浏览器和页面信息
      const browserInfo = Array.from(this.browsers.entries()).map(
        ([edgeId, data]) => {
          return {
            edgeId,
            pageCount: data.pages.size,
            pageIds: Array.from(data.pages.keys()),
            isConnected: data.browser.isConnected(),
          };
        }
      );

      this.server.sendLoggingMessage({
        level: 'info',
        data: `Active browsers: ${JSON.stringify(browserInfo)}`,
      });

      // 清理KOL相关的页面
      await this.cleanupKolPages(KOL_NAMES);
      // closeAllBrowsers
      await this.closeAllBrowsers();
      // 更新后的浏览器信息
      const updatedBrowserInfo = Array.from(this.browsers.entries()).map(
        ([edgeId, data]) => {
          return {
            edgeId,
            pageCount: data.pages.size,
            pageIds: Array.from(data.pages.keys()),
          };
        }
      );

      this.server.sendLoggingMessage({
        level: 'info',
        data: `Browsers after cleanup: ${JSON.stringify(updatedBrowserInfo)}`,
      });

      return {
        content: [
          {
            type: 'text',
            text: `${JSON.stringify(
              {
                tweets,
                activeEdgeIds: EDGE_IDS,
                browserInfo: updatedBrowserInfo,
              },
              null,
              2
            )}`,
          },
        ],
        isError: false,
      };
    } catch (error) {
      this.server.sendLoggingMessage({
        level: 'error',
        data: `Error in handleGetWeb3Hotspot: ${formatError(error)}`,
      });
      await this.cleanupKolPages(KOL_NAMES);
      await this.closeAllBrowsers();
      return {
        content: [
          {
            type: 'text',
            text: `Failed to get web3 tweets: ${formatError(error)}`,
          },
        ],
        isError: true,
      };
    }
  }

  /**
   * Send a tweet
   * @param args
   * @returns
   */
  private async handleSendTweet(args: any): Promise<CallToolResult> {
    try {
      const { tweet } = args;
      const edgeId = process.env.X_EDGEID;
      if (!edgeId) {
        throw new Error('X_EDGEID is not set');
      }
      const user = process.env.X_EMAIL;
      if (!user) {
        throw new Error('X_EMAIL is not set');
      }
      const password = process.env.X_PASSWORD;
      if (!password) {
        throw new Error('X_PASSWORD is not set');
      }
      const kol = 'send_tweet';
      const page = await this.getOrCreatePage(edgeId, kol);

      await sendTweet(user, password, page, tweet);

      await this.cleanupKolPages([kol]);
      await this.closeAllBrowsers();
      return {
        content: [
          {
            type: 'text',
            text: `Sending tweet: ${args.tweet}`,
          },
        ],
        isError: false,
      };
    } catch (error) {
      // 关闭浏览器
      await this.cleanupKolPages(['send_tweet']);
      await this.closeAllBrowsers();
      return {
        content: [
          {
            type: 'text',
            text: `Failed to send tweet: ${formatError(error)}`,
          },
        ],
        isError: true,
      };
    }
  }

  private async handleBrowserConsoleLogs(args: any): Promise<CallToolResult> {
    try {
      return {
        content: [
          {
            type: 'text',
            text: this.consoleLogs.join('\n'),
          },
        ],
        isError: false,
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Failed to get browser console logs: ${formatError(error)}`,
          },
        ],
        isError: true,
      };
    }
  }

  private async handleTakeScreenshot(args: any): Promise<CallToolResult> {
    try {
      // Validate required parameters
      if (
        !args.tasks ||
        !Array.isArray(args.tasks) ||
        args.tasks.length === 0
      ) {
        throw new Error('tasks array is required');
      }

      // Process all screenshot tasks
      const contentItems: Array<
        | { type: 'text'; text: string }
        | { type: 'image'; data: string; mimeType: string }
      > = [];

      for (const task of args.tasks) {
        const { edgeId, name, selector, fullPage, pageId } = task;

        if (!edgeId || !name) {
          contentItems.push({
            type: 'text',
            text: 'Error: edgeId and name are required for each task',
          });
          continue;
        }

        try {
          // 获取浏览器实例
          const { browser, context } = await this.getOrCreateBrowser(edgeId);
          const browserData = this.browsers.get(edgeId)!;

          // 确定使用哪个页面
          let page: Page;
          if (pageId && browserData.pages.has(pageId)) {
            // 使用指定的页面
            page = browserData.pages.get(pageId)!;
          } else if (browserData.pages.has(edgeId)) {
            // 使用默认页面
            page = browserData.pages.get(edgeId)!;
          } else {
            // 没有找到合适的页面，创建一个新标签页
            page = await context.newPage();
            // 使用edgeId作为默认页面ID
            browserData.pages.set(edgeId, page);

            // 设置控制台日志记录
            page.on('console', (msg) => {
              const logEntry = `[${edgeId}][${msg.type()}] ${msg.text()}`;
              this.consoleLogs.push(logEntry);
              this.server.notification({
                method: 'notifications/resources/updated',
                params: { uri: 'console://logs' },
              });
            });

            this.server.sendLoggingMessage({
              level: 'info',
              data: `Created new default tab for browser ${edgeId}`,
            });
          }

          this.server.sendLoggingMessage({
            level: 'info',
            data: `Taking screenshot of ${edgeId} ${
              pageId ? `(page ${pageId})` : ''
            } ${selector ? 'element' : 'page'}`,
          });

          // Take screenshot of specific element or full page
          const screenshot = await (selector
            ? page.locator(selector).screenshot()
            : page.screenshot({ fullPage: !!fullPage }));

          const base64Screenshot = screenshot.toString('base64');

          if (!base64Screenshot) {
            contentItems.push({
              type: 'text',
              text: selector
                ? `Element not found: ${selector}`
                : 'Screenshot failed',
            });
            continue;
          }

          // Save screenshot to memory
          this.screenshots.set(name, base64Screenshot);

          // Send notification that resources list has changed
          this.server.notification({
            method: 'notifications/resources/list_changed',
          });

          // Add text and image content items
          contentItems.push({
            type: 'text',
            text: `Screenshot '${name}' taken from ${edgeId}${
              pageId ? ` (page ${pageId})` : ''
            }`,
          });

          contentItems.push({
            type: 'image',
            data: base64Screenshot,
            mimeType: 'image/png',
          });
        } catch (screenshotError) {
          contentItems.push({
            type: 'text',
            text: `Failed to take screenshot for ${edgeId}: ${formatError(
              screenshotError
            )}`,
          });
        }
      }

      return {
        content: contentItems,
        isError: false,
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Failed to take screenshots: ${formatError(error)}`,
          },
        ],
        isError: true,
      };
    }
  }

  private async handleNavigateToUrl(args: any): Promise<CallToolResult> {
    try {
      // Validate required parameters
      if (
        !args.tasks ||
        !Array.isArray(args.tasks) ||
        args.tasks.length === 0
      ) {
        throw new Error('tasks array is required');
      }

      // Process all navigation tasks
      const contentItems: Array<{ type: 'text'; text: string }> = [];

      for (const task of args.tasks) {
        const { edgeId, url, waitUntil, pageId } = task;

        if (!edgeId || !url) {
          contentItems.push({
            type: 'text',
            text: 'Error: edgeId and url are required for each task',
          });
          continue;
        }

        try {
          // 获取浏览器实例
          const { browser, context } = await this.getOrCreateBrowser(edgeId);
          const browserData = this.browsers.get(edgeId)!;

          // 确定使用哪个页面
          let page: Page;
          if (pageId && browserData.pages.has(pageId)) {
            // 使用指定的页面
            page = browserData.pages.get(pageId)!;
          } else if (browserData.pages.has(edgeId)) {
            // 使用默认页面
            page = browserData.pages.get(edgeId)!;
          } else {
            // 没有找到合适的页面，创建一个新标签页
            page = await context.newPage();
            // 使用edgeId作为默认页面ID
            browserData.pages.set(edgeId, page);

            // 设置控制台日志记录
            page.on('console', (msg) => {
              const logEntry = `[${edgeId}][${msg.type()}] ${msg.text()}`;
              this.consoleLogs.push(logEntry);
              this.server.notification({
                method: 'notifications/resources/updated',
                params: { uri: 'console://logs' },
              });
            });

            this.server.sendLoggingMessage({
              level: 'info',
              data: `Created new default tab for browser ${edgeId}`,
            });
          }

          // Navigation options
          const navigationOptions: any = {};
          if (waitUntil) {
            navigationOptions.waitUntil = waitUntil;
          }

          // Navigate to URL
          const response = await page.goto(url, navigationOptions);

          // Add log
          const logEntry = this.formatLog(
            edgeId,
            'navigation',
            `Navigated to: ${url}${pageId ? ` (page ${pageId})` : ''}`
          );
          this.consoleLogs.push(logEntry);

          // Get page title
          const title = await page.title();

          contentItems.push({
            type: 'text',
            text: `Navigated ${edgeId}${
              pageId ? ` (page ${pageId})` : ''
            } to: ${url}\nPage title: ${title}\nStatus: ${
              response?.status() || 'unknown'
            }`,
          });
        } catch (navigationError) {
          contentItems.push({
            type: 'text',
            text: `Failed to navigate ${edgeId}${
              pageId ? ` (page ${pageId})` : ''
            } to ${url}: ${formatError(navigationError)}`,
          });
        }
      }

      return {
        content: contentItems,
        isError: false,
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Failed to navigate to URLs: ${formatError(error)}`,
          },
        ],
        isError: true,
      };
    }
  }

  // Start the server
  public async run() {
    // Register additional process termination handlers
    process.on('SIGTERM', this.handleShutdown.bind(this));
    process.on('uncaughtException', async (error) => {
      console.error('Uncaught exception:', error);
      await this.handleShutdown();
    });
    process.on('unhandledRejection', async (reason) => {
      console.error('Unhandled rejection:', reason);
      await this.handleShutdown();
    });

    // Connect stdio transport for command line interaction
    try {
      this.stdioTransport = new StdioServerTransport();
      await this.server.connect(this.stdioTransport);
      this.server.sendLoggingMessage({
        level: 'info',
        data: 'StdioServerTransport connected successfully',
      });
    } catch (error) {
      console.error(
        'Failed to connect StdioServerTransport:',
        formatError(error)
      );
    }
  }

  // Graceful shutdown handler
  private async handleShutdown() {
    this.server.sendLoggingMessage({
      level: 'info',
      data: 'Shutting down server...',
    });

    // Close all browsers first
    await this.closeAllBrowsers();

    // Close stdio transport if it exists
    if (this.stdioTransport) {
      try {
        await this.stdioTransport.close();
      } catch (error) {
        console.error('Error closing stdio transport:', formatError(error));
      }
    }

    this.server.sendLoggingMessage({
      level: 'info',
      data: 'Server shutdown complete',
    });
    process.exit(0);
  }

  /**
   * 关闭所有浏览器实例
   */
  private async closeAllBrowsers() {
    this.server.sendLoggingMessage({
      level: 'info',
      data: 'Closing all browser instances...',
    });
    try {
      for (const [id, { browser, context }] of this.browsers.entries()) {
        try {
          // 先关闭上下文，再关闭浏览器
          await context.close();
          await browser.close();
          this.server.sendLoggingMessage({
            level: 'info',
            data: `Browser instance ${id} closed successfully`,
          });
        } catch (error) {
          console.error(
            `Error closing browser instance ${id}:`,
            formatError(error)
          );
        }
      }
      this.browsers.clear();
    } catch (error) {
      console.error('Error in closeAllBrowsers:', formatError(error));
    }
  }
}

// Create and run server
const server = new PlaywrightMcpServer();
server.run().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});
