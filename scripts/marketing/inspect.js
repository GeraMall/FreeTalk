/* global window, document, innerWidth */
// Playwright CLI evaluates this file as a function expression.
// prettier-ignore
// eslint-disable-next-line @typescript-eslint/no-unused-expressions
;async (page) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto("http://127.0.0.1:1440/marketing/")
  await page.waitForFunction(() => window.marketing)
  const results = []
  for (const scene of ["friends", "chat", "call", "screen"]) {
    await page.evaluate((s) => window.marketing.scene(s), scene)
    await page.waitForTimeout(900)
    await page.screenshot({
      path: `D:/FreeTalk-gifs/output/playwright/marketing-${scene}.png`,
    })
    results.push({
      scene,
      overflow: await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      video: await page
        .locator("video")
        .evaluateAll((vs) =>
          vs.map((v) => ({
            width: v.videoWidth,
            height: v.videoHeight,
            ready: v.readyState,
          })),
        ),
    })
  }
  return results
}
