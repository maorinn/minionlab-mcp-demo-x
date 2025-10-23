import { Browser, chromium, Page } from 'playwright';

const SERVER_URL = 'ws://any.browsers.live:3000';
export let EDGE_IDS = process.env.EDGE_IDS?.split(',') || ['2ef67d1859e83183'];

/**
 * Set EDGE_IDS
 * @param edgeIds {string[]} Browser instance IDs
 */
export const setEdgeIds = (edgeIds: string[]) => {
  EDGE_IDS = edgeIds;
};
/**
 * Launch a browser instance
 * @param edgeId {string} The ID of the browser instance
 * @returns {Browser} The browser instance
 */
export const launchBrowser = async (
  edgeId: string
): Promise<{
  edgeId: string;
  browser: Browser;
}> => {
  // Configure launch options dynamically based on edgeId

  let options;
  if (edgeId && edgeId !== 'undefined') {
    options = {
      args: [
        '--datascaler-apikey=datascaler-persist-aipkey',
        '--datascaler-select-node=' + edgeId,
      ],
    };
  } else {
    options = { args: ['--datascaler-apikey=datascaler-persist-aipkey'] };
  }
  const urlOptionValue = encodeURIComponent(JSON.stringify(options));
  const serverUrl = SERVER_URL + '?launch-options=' + urlOptionValue;
  const browser = await chromium.connect(serverUrl);

  // Save node ID to the browser instance
  (browser as any)['edgeId'] = edgeId;
  return {
    edgeId,
    browser,
  };
};

/**
 * Close a browser instance
 * @param browser {Browser} The browser instance
 */
export const closeBrowser = async (browser: Browser): Promise<void> => {
  try {
    await browser.close();
  } catch (error) {
    console.error('Error while closing browser:', error);
  }
};

/**
 * Launch browser by index
 */
export const launchBrowserByIndex = async (index: number) => {
  const edgeId = EDGE_IDS[index];
  return await launchBrowser(edgeId);
};
