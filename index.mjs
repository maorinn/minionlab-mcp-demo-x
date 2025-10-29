import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
const apikey = 'api_f8cb115ef21d21b2b56321b6d33b3d79';
const region = 'any';
const defaultUsernames = [
    'elonmusk',
    'realdonaldtrump',
    'solana',
];
const CONCURRENCY = 3;
const MAX_TWEETS = 100;
class TwitterClusterDemo {
    constructor(config = {}) {
        this.concurrency = config.concurrency || CONCURRENCY;
        this.usernames = config.usernames || [];
        this.maxTweets = config.maxTweets || MAX_TWEETS;
        this.results = [];
        this.activeWorkers = 0;
        this.completedTasks = 0;
        this.failedTasks = 0;
        this.startTime = null;
        this.progressDisplayed = false;
        this.activeMessages = new Map(); // Store active scraping messages
        this.animationInterval = null;
        this.lastMessageCount = 0;
        this.usernameStatus = new Map(); // Track completion per username
        this.usernameAttemptsRemaining = new Map(); // Track remaining attempts per username
        this.activeBrowsers = new Map(); // Track active browser instances per username
    }

    async createBrowserSession() {
        const options = { _apikey: apikey };
        const urlOptionValue = encodeURIComponent(JSON.stringify(options));
        const serverUrl = 'wss://any.browsers.live?launch-options=' + urlOptionValue;

        return await chromium.connect(serverUrl);
    }

    async scrapeTwitterProfileWithRetry(username, workerId) {
        const MAX_RETRIES = 3;
        let lastError = null;

        if (this.usernameStatus.get(username)?.completed) {
            return this.buildCancelledResult(username, workerId);
        }

        for (let retryCount = 0; retryCount <= MAX_RETRIES; retryCount++) {
            if (this.usernameStatus.get(username)?.completed) {
                return this.buildCancelledResult(username, workerId);
            }

            let currentBrowser;
            let browserHandle;
            try {
                currentBrowser = await this.createBrowserSession();
                if (this.usernameStatus.get(username)?.completed) {
                    return this.buildCancelledResult(username, workerId);
                }

                browserHandle = {
                    browser: currentBrowser,
                    workerId,
                    cancelled: false
                };
                this.registerActiveBrowser(username, browserHandle);

                const result = await this.scrapeTwitterProfile(currentBrowser, username, workerId);

                if (!this.usernameStatus.get(username)?.completed) {
                    this.usernameStatus.set(username, { completed: true, success: true });
                }

                await this.abortOtherBrowsers(username, browserHandle);

                return result;
            } catch (error) {
                lastError = error;
                if (browserHandle && browserHandle.cancelled) {
                    return this.buildCancelledResult(username, workerId);
                }

                const isTimeoutError = error.message.includes('timeout') || error.message.includes('Timeout');

                if (isTimeoutError && retryCount < MAX_RETRIES) {
                    continue;
                } else {
                    break;
                }
            } finally {
                if (currentBrowser) {
                    try {
                        await currentBrowser.close();
                    } catch (e) {
                        // Ignore close errors
                    }
                }
                if (browserHandle) {
                    this.removeActiveBrowser(username, browserHandle);
                }
            }
        }

        // All retries exhausted, log error and take screenshot
        try {
            const fallbackBrowser = await this.createBrowserSession();
            const page = await fallbackBrowser.newPage();
            await page.goto(`https://x.com/${username}`, { timeout: 10000 });
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const screenshotPath = `screenshots/error_${username}_${workerId}_${timestamp}.png`;
            await page.screenshot({ path: screenshotPath, fullPage: true });
            console.log(`[${workerId}] 📸 Scraping failed after retries, screenshot saved: ${screenshotPath}`);
            await page.close();
            await fallbackBrowser.close();
        } catch (screenshotError) {
            console.log(`[${workerId}] ⚠️ Screenshot failed: ${screenshotError.message}`);
        }

        // Failure log
        const errorMessage = lastError ? lastError.message : 'Unknown error';
        process.stdout.write(`\x1b[31m[${workerId}] ✗ @${username} - ${errorMessage.substring(0, 40)}...\x1b[0m\n`);

        return {
            username,
            success: false,
            error: errorMessage,
            duration: 0,
            workerId,
            newBrowser: null
        };
    }

    async scrapeTwitterProfile(browser, username, workerId) {
        const page = await browser.newPage();
        const startTime = Date.now();

        try {
            // Add dynamic scraping message
            this.addActiveMessage(workerId, username);

            // Start animation if not already started
            if (!this.animationInterval) {
                this.startAnimation();
            }

            await page.goto(`https://x.com/${username}`, {
                timeout: 45000,
                waitUntil: 'domcontentloaded'
            });

            // Wait for page to load
            await page.waitForTimeout(5000);

            // Try to wait for tweet elements to appear
            try {
                await page.waitForSelector('[data-testid="tweet"]', { timeout: 35000 });
            } catch (e) {
                // Silent handling - no retry info logged
            }

            const profileData = await page.evaluate((maxTweets) => {
                const getTextContent = (selector, element = document) => {
                    const el = element.querySelector(selector);
                    return el ? el.textContent.trim() : '';
                };


                // Get basic user information
                const profileName = getTextContent('[data-testid="UserName"] span') ||
                    getTextContent('h2[role="heading"] span') ||
                    '';

                const profileDescription = getTextContent('[data-testid="UserDescription"]') ||
                    getTextContent('[role="presentation"] + div span') ||
                    '';

                const followersCount = getTextContent('[href$="/verified_followers"] span, [href$="/followers"] span') ||
                    getTextContent('a[role="link"] span:contains("Followers")') ||
                    '';

                const followingCount = getTextContent('[href$="/following"] span') ||
                    '';

                // Get recent tweets
                const tweetElements = document.querySelectorAll('[data-testid="tweet"]');
                const tweets = [];

                for (let i = 0; i < Math.min(tweetElements.length, maxTweets); i++) {
                    const tweetEl = tweetElements[i];

                    const tweetText = getTextContent('[data-testid="tweetText"]', tweetEl) ||
                        getTextContent('[lang]', tweetEl) ||
                        '';

                    const tweetTime = getTextContent('time', tweetEl) ||
                        getTextContent('[datetime]', tweetEl) ||
                        '';

                    const retweetCount = getTextContent('[data-testid="retweet"] span', tweetEl) ||
                        getTextContent('[aria-label*="retweet"]', tweetEl) ||
                        '';

                    const likeCount = getTextContent('[data-testid="like"] span', tweetEl) ||
                        getTextContent('[aria-label*="like"]', tweetEl) ||
                        '';

                    if (tweetText) {
                        tweets.push({
                            text: tweetText.substring(0, 280),
                            time: tweetTime,
                            retweets: retweetCount,
                            likes: likeCount
                        });
                    }
                }

                return {
                    profileName: profileName.substring(0, 100),
                    description: profileDescription.substring(0, 200),
                    followers: followersCount,
                    following: followingCount,
                    tweets: tweets
                };
            }, this.maxTweets);

            const duration = Date.now() - startTime;

            // Screenshot for debugging if 0 tweets found
            if (profileData.tweets.length === 0) {
                const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                const screenshotPath = `screenshots/debug_${username}_${workerId}_${timestamp}.png`;
                await page.screenshot({ path: screenshotPath, fullPage: true });
                console.log(`[${workerId}] 🔍 0 tweets found, screenshot saved: ${screenshotPath}`);
            }

            // Remove dynamic message
            this.removeActiveMessage(workerId);

            // Success log
            process.stdout.write(`\x1b[32m[${workerId}] ✓ @${username} (${profileData.tweets.length} tweets)\x1b[0m\n`);

            return {
                username,
                success: true,
                data: profileData,
                duration,
                workerId
            };

        } catch (error) {
            // Remove dynamic message
            this.removeActiveMessage(workerId);

            throw error; // Re-throw for retry handling
        } finally {
            await page.close();
        }
    }

    async processQueue(taskQueue, workerIndex) {
        const workerId = `W${workerIndex.toString().padStart(2, '0')}`;
        this.activeWorkers++;

        try {
            while (taskQueue.length > 0) {
                const task = taskQueue.shift();
                if (!task) break;

                const { username, attempt } = task;
                const usernameState = this.usernameStatus.get(username);

                if (usernameState && usernameState.completed) {
                    continue;
                }

                const attemptId = `${workerId}-A${attempt}`;
                process.stdout.write(`\x1b[36m[${attemptId}] Connecting to browser...\x1b[0m\n`);

                const result = await this.scrapeTwitterProfileWithRetry(username, attemptId);

                if (result.cancelled) {
                    await this.randomDelay(500, 1000);
                    continue;
                }

                if (result.success) {
                    this.usernameStatus.set(username, { completed: true, success: true });
                    result.workerId = attemptId;
                    this.results.push(result);
                    this.completedTasks++;
                    this.printProgress();
                    await this.randomDelay(2000, 4000);
                    continue;
                }

                const remainingAttempts = (this.usernameAttemptsRemaining.get(username) || this.concurrency) - 1;
                this.usernameAttemptsRemaining.set(username, Math.max(remainingAttempts, 0));

                if (remainingAttempts <= 0) {
                    this.usernameStatus.set(username, { completed: true, success: false });
                    result.workerId = attemptId;
                    this.results.push(result);
                    this.failedTasks++;
                    this.printProgress();
                }

                // Random delay to avoid rate limiting
                await this.randomDelay(2000, 4000);
            }

        } catch (error) {
            console.log(`[Worker ${workerId}] Critical error: ${error.message}`);
        } finally {
            this.activeWorkers--;
        }
    }

    async randomDelay(min = 1000, max = 3000) {
        const delay = Math.floor(Math.random() * (max - min + 1)) + min;
        await new Promise(resolve => setTimeout(resolve, delay));
    }

    registerActiveBrowser(username, handle) {
        if (!this.activeBrowsers.has(username)) {
            this.activeBrowsers.set(username, new Set());
        }
        this.activeBrowsers.get(username).add(handle);
    }

    removeActiveBrowser(username, handle) {
        const activeSet = this.activeBrowsers.get(username);
        if (!activeSet) return;

        activeSet.delete(handle);
        if (activeSet.size === 0) {
            this.activeBrowsers.delete(username);
        }
    }

    async abortOtherBrowsers(username, keepHandle) {
        const activeSet = this.activeBrowsers.get(username);
        if (!activeSet) return;

        const toClose = Array.from(activeSet).filter(handle => handle !== keepHandle);
        await Promise.allSettled(toClose.map(async (handle) => {
            handle.cancelled = true;
            try {
                await handle.browser.close();
            } catch (e) {
                // Ignore close errors during cancellation
            } finally {
                activeSet.delete(handle);
            }
        }));
    }

    buildCancelledResult(username, workerId) {
        return {
            username,
            success: false,
            error: 'Scrape cancelled after another attempt succeeded',
            duration: 0,
            workerId,
            cancelled: true,
            newBrowser: null
        };
    }

    addActiveMessage(workerId, username) {
        this.activeMessages.set(workerId, {
            username,
            workerId,
            startTime: Date.now(),
            dotCount: 0
        });
        this.updateActiveMessages();
    }

    removeActiveMessage(workerId) {
        this.activeMessages.delete(workerId);
        this.updateActiveMessages();

        // 如果没有活跃消息了，停止动画
        if (this.activeMessages.size === 0 && this.animationInterval) {
            clearInterval(this.animationInterval);
            this.animationInterval = null;
        }
    }

    startAnimation() {
        this.animationInterval = setInterval(() => {
            // Update dots for each message
            for (let [, message] of this.activeMessages) {
                message.dotCount = (message.dotCount + 1) % 4;
            }
            this.updateActiveMessages();
        }, 500); // Update every 500ms
    }

    updateActiveMessages() {
        if (this.activeMessages.size === 0) return;

        // Clear previous messages if any
        if (this.lastMessageCount && this.lastMessageCount > 0) {
            // Move up to start of message area and clear
            process.stdout.write(`\x1b[${this.lastMessageCount}A\x1b[J`);
        }

        // Redraw all active messages
        for (let [, message] of this.activeMessages) {
            const dots = '.'.repeat(message.dotCount);
            const spaces = ' '.repeat(3 - message.dotCount);
            const elapsed = ((Date.now() - message.startTime) / 1000).toFixed(0);
            process.stdout.write(`\x1b[33m[${message.workerId}] Scraping @${message.username} tweet data${dots}${spaces} (${elapsed}s)\x1b[0m\n`);
        }

        // Remember how many message lines were displayed
        this.lastMessageCount = this.activeMessages.size;
    }

    printProgress() {
        const totalTasks = this.usernames.length;
        const processedTasks = this.completedTasks + this.failedTasks;
        const progressPercent = ((processedTasks / totalTasks) * 100).toFixed(1);
        const elapsed = this.startTime ? ((Date.now() - this.startTime) / 1000).toFixed(1) : 0;

        // Create progress bar
        const barLength = 30;
        const filledLength = Math.round((processedTasks / totalTasks) * barLength);
        const progressBar = '█'.repeat(filledLength) + '░'.repeat(barLength - filledLength);

        // Progress box display
        const progressBox = [
            `┌─────────────────────── 📊 Scraping Progress ──────────────────────┐`,
            `│ Progress: [${progressBar}] ${progressPercent.padStart(5)}% │`,
            `│ Tasks: ${processedTasks.toString().padStart(2)}/${totalTasks} │ ✅ ${this.completedTasks.toString().padStart(2)} │ ❌ ${this.failedTasks.toString().padStart(2)} │ 🔄 ${this.activeWorkers} workers │`,
            `│ Time: ${elapsed.padStart(6)}s                                      │`,
            `└──────────────────────────────────────────────────────────────────┘`
        ];

        // Add newline for first progress display
        if (!this.progressDisplayed) {
            process.stdout.write('\n');
            this.progressDisplayed = true;
        }

        // Clear previous progress display (move up 5 lines and clear)
        process.stdout.write('\x1b[5A\x1b[J');

        // Redraw progress box
        progressBox.forEach(line => {
            process.stdout.write(line + '\n');
        });
    }

    async run() {
        if (this.usernames.length === 0) {
            console.log('❌ No Twitter usernames provided for scraping');
            return;
        }

        this.startTime = Date.now();
        console.log(`🚀 Starting Twitter cluster scraping demo`);
        console.log(`👤 Users to scrape: ${this.usernames.length}`);
        console.log(`📝 Max tweets per user: ${this.maxTweets}`);
        console.log(`⚡ Concurrency: ${this.concurrency}`);
        console.log(`🌐 Region: ${region}\n`);

        const taskQueue = [];
        this.usernames.forEach((username) => {
            this.usernameStatus.set(username, { completed: false, success: null });
            this.usernameAttemptsRemaining.set(username, this.concurrency);
            for (let attempt = 1; attempt <= this.concurrency; attempt++) {
                taskQueue.push({ username, attempt });
            }
        });

        const workerCount = Math.min(this.concurrency, taskQueue.length) || 1;
        const workers = [];

        for (let i = 0; i < workerCount; i++) {
            workers.push(this.processQueue(taskQueue, i + 1));
        }

        await Promise.all(workers);

        const totalTime = ((Date.now() - this.startTime) / 1000).toFixed(1);

        // Stop animation
        if (this.animationInterval) {
            clearInterval(this.animationInterval);
            this.animationInterval = null;
        }

        // Clear active messages and progress display
        if (this.activeMessages.size > 0) {
            process.stdout.write(`\x1b[${this.activeMessages.size}A\x1b[J`);
        }
        if (this.progressDisplayed) {
            process.stdout.write('\x1b[5A\x1b[J');
        }

        console.log(`\n┌─────────────────────── 🎉 Scraping Complete ──────────────────────┐`);
        console.log(`│ Summary: ✅ ${this.completedTasks} success │ ❌ ${this.failedTasks} failed │ ⏱️ ${totalTime}s          │`);
        console.log(`└───────────────────────────────────────────────────────────────────┘\n`);

        this.printResults();
    }

    printResults() {
        console.log(`\n${'═'.repeat(90)}`);
        console.log(`                           📋 Scraping Results Details`);
        console.log(`${'═'.repeat(90)}`);

        this.results.forEach((result, index) => {
            console.log(`\n┌─ [${index + 1}] @${result.username.padEnd(18)} │ Worker: ${result.workerId} │ Duration: ${result.duration}ms`);

            if (result.success) {
                const data = result.data;
                console.log(`├─ ✅ Status: Success`);
                console.log(`├─ 👤 User: ${(data.profileName || 'Not retrieved').substring(0, 40)}`);
                console.log(`├─ 📝 Bio: ${(data.description || 'Not retrieved').substring(0, 50)}${data.description && data.description.length > 50 ? '...' : ''}`);
                console.log(`├─ 👥 Followers: ${data.followers || '0'} │ Following: ${data.following || '0'}`);
                console.log(`├─ 📱 Tweets: ${data.tweets.length}`);

                if (data.tweets.length > 0) {
                    console.log(`├─ ${'─'.repeat(75)}`);
                    data.tweets.slice(0, 6).forEach((tweet, tweetIndex) => {
                        const isLast = tweetIndex === Math.min(data.tweets.length, 6) - 1;
                        const prefix = isLast ? '└─' : '├─';
                        const tweetText = tweet.text.replace(/\n/g, ' ').substring(0, 65);
                        const displayText = tweet.text.length > 65 ? tweetText + '...' : tweetText;

                        console.log(`${prefix} [${tweetIndex + 1}] ${displayText}`);
                        const stats = `⏰ ${(tweet.time || 'Unknown').substring(0, 12)} │ 🔄 ${tweet.retweets || '0'} │ ❤️ ${tweet.likes || '0'}`;
                        console.log(`${isLast ? '  ' : '│'} └─ ${stats}`);
                    });
                    if (data.tweets.length > 6) {
                        console.log(`   └─ ... ${data.tweets.length - 6} more tweets not displayed`);
                    }
                } else {
                    console.log(`└─ 📭 No tweet data`);
                }
            } else {
                console.log(`├─ ❌ Status: Failed`);
                console.log(`└─ 🚫 Error: ${result.error.substring(0, 60)}${result.error.length > 60 ? '...' : ''}`);
            }

            if (index < this.results.length - 1) {
                console.log(`\n${'─'.repeat(90)}`);
            }
        });

        console.log(`\n${'═'.repeat(90)}`);
    }
}

async function main() {
    const demo = new TwitterClusterDemo({
        usernames: process.env.USERNAMES ? process.env.USERNAMES.split(',') : defaultUsernames,
        concurrency: parseInt(process.env.CONCURRENCY) || CONCURRENCY,
        maxTweets: parseInt(process.env.MAX_TWEETS) || MAX_TWEETS,
    });

    try {
        await demo.run();
    } catch (error) {
        console.error('Demo run failed:', error);
    }
}

const entryFilePath = fileURLToPath(import.meta.url);

if (process.argv[1] === entryFilePath) {
    main().catch((error) => {
        console.error(error);
        if (process.exitCode === undefined) {
            process.exitCode = 1;
        }
    });
}

export default TwitterClusterDemo;
