// Opt-in V8 coverage for the existing browser suites, without editing them.
//
//   MOLGPU_BROWSER_COVERAGE=<dir> deno test -A \
//     --preload scripts/browser-coverage-hook.mjs packages/viewer/test/run-x.mjs
//
// Wraps Playwright's `chromium.launch` so every page a suite opens records
// precise JS coverage, and writes the workspace-source entries (Vite serves
// them transformed, with inline source maps) to one JSON file per page when
// the page or browser closes. Read the results with
// scripts/browser-coverage-report.mjs. Without the variable this is a no-op.
import { chromium } from "playwright";

const dir = Deno.env.get("MOLGPU_BROWSER_COVERAGE");
const SOURCE = /\/packages\/[^/]+\/src\//;
// Fixtures built by Vite (inline maps via MOLGPU_BROWSER_COVERAGE) serve a few
// bundles instead of per-module files; the lazy Mol* chunk has no workspace code.
const BUNDLE = /\/assets\/(?!molstar)[^/]+\.js$/;

if (dir) {
  await Deno.mkdir(dir, { recursive: true });
  const suite = Deno.mainModule.split("/").slice(-3).join("-").replace(
    /\.m?[jt]s$/,
    "",
  );
  let pageCount = 0;
  // browser.newPage goes through a wrapped context's newPage; track once.
  const tracked = new WeakSet();
  const launch = chromium.launch.bind(chromium);

  const track = async (page) => {
    await page.coverage.startJSCoverage({ resetOnNavigation: false });
    const id = pageCount++;
    let written = false;
    const flush = async () => {
      if (written || page.isClosed()) return;
      written = true;
      const entries = (await page.coverage.stopJSCoverage())
        .filter((entry) => {
          const { pathname } = new URL(entry.url);
          return SOURCE.test(pathname) || BUNDLE.test(pathname);
        })
        .map(({ url, source, functions }) => ({ url, source, functions }));
      await Deno.writeTextFile(
        `${dir}/${suite}-${id}.json`,
        JSON.stringify({ suite, entries }),
      );
    };
    const close = page.close.bind(page);
    page.close = async (options) => {
      await flush().catch((error) =>
        console.warn(`coverage: ${suite} page ${id}: ${error.message}`)
      );
      return close(options);
    };
    return flush;
  };

  chromium.launch = async (options) => {
    const browser = await launch(options);
    const flushes = [];
    const wrapNewPage = (owner) => {
      const newPage = owner.newPage.bind(owner);
      owner.newPage = async (options) => {
        const page = await newPage(options);
        if (!tracked.has(page)) {
          tracked.add(page);
          flushes.push(await track(page));
        }
        return page;
      };
    };
    wrapNewPage(browser);
    const newContext = browser.newContext.bind(browser);
    browser.newContext = async (options) => {
      const context = await newContext(options);
      wrapNewPage(context);
      return context;
    };
    const closeBrowser = browser.close.bind(browser);
    browser.close = async (options) => {
      for (const flush of flushes) {
        await flush().catch((error) =>
          console.warn(`coverage: ${suite}: ${error.message}`)
        );
      }
      return closeBrowser(options);
    };
    return browser;
  };
}
