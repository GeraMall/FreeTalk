/* global window, document, innerWidth, scrollTo, performance, getComputedStyle */
// Playwright CLI evaluates this file as a function expression.
// prettier-ignore
// eslint-disable-next-line @typescript-eslint/no-unused-expressions
;async (page) => {
  const browser = page.context().browser()
  const report = []
  for (const width of [1920, 1280, 1024, 820, 390, 320]) {
    const context = await browser.newContext({
      viewport: { width, height: 900 },
      isMobile: width < 600,
      hasTouch: width < 600,
    })
    const p = await context.newPage()
    const errors = []
    p.on("pageerror", (e) => errors.push(e.message))
    await p.goto("http://127.0.0.1:1442/")
    await p.evaluate(() =>
      document
        .querySelectorAll("[data-reveal]")
        .forEach((e) => e.classList.add("visible")),
    )
    await p.locator("#download").scrollIntoViewIfNeeded()
    await p.waitForTimeout(300)
    await p.evaluate(() => scrollTo({ top: 0, behavior: "instant" }))
    await p.waitForTimeout(200)
    await p.locator("img").evaluateAll(async (images) => {
      await Promise.all(
        images.map(async (image) => {
          image.loading = "eager"
          await image.decode()
        }),
      )
    })
    const layout = await p.evaluate(() => ({
      width: innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      images: [...document.images]
        .filter((i) => !i.complete || !i.naturalWidth)
        .map((i) => i.src),
      featureOverflow: [...document.querySelectorAll(".feature")].some(
        (e) => e.scrollWidth > e.clientWidth + 1,
      ),
    }))
    if (
      layout.scrollWidth > width ||
      layout.images.length ||
      layout.featureOverflow
    )
      throw new Error(JSON.stringify(layout))
    const initialVideoRequests = await p.evaluate(
      () =>
        performance
          .getEntriesByType("resource")
          .filter((e) => e.name.endsWith(".mp4")).length,
    )
    if (initialVideoRequests)
      throw new Error("Video was loaded before being requested")
    if ([1280, 820, 390].includes(width))
      await p.screenshot({
        path: `D:/FreeTalk-gifs/output/playwright/marketing-landing-${width}.png`,
        fullPage: true,
      })
    await p.locator(".tour-launch").click()
    await p.locator("dialog[open]").waitFor()
    await p.waitForFunction(
      () => document.querySelector("video").readyState >= 2,
    )
    const video = await p
      .locator("video")
      .evaluate((v) => ({
        width: v.videoWidth,
        height: v.videoHeight,
        duration: v.duration,
      }))
    await p.getByRole("button", { name: "Закрыть видео" }).click()
    if (!(await p.locator("video").evaluate((v) => v.paused)))
      throw new Error("Video still playing after close")
    if (
      !(await p
        .locator(".tour-launch")
        .evaluate((e) => e === document.activeElement))
    )
      throw new Error("Focus not restored")
    report.push({ kind: "landing", ...layout, video, errors })
    await context.close()
  }
  for (const width of [1920, 1366, 1280, 1024, 900, 820]) {
    const context = await browser.newContext({
      viewport: { width, height: 900 },
    })
    const p = await context.newPage()
    await p.goto("http://127.0.0.1:1440/marketing/")
    await p.waitForFunction(() => window.marketing)
    for (const scene of ["friends", "chat", "call", "screen"]) {
      await p.evaluate((s) => window.marketing.scene(s), scene)
      await p.waitForTimeout(350)
      const layout = await p.evaluate(() => {
        const side = document
          .querySelector(".account-sidebar")
          .getBoundingClientRect()
        const content =
          document.querySelector(".friends-page") ||
          document.querySelector(".participants-grid") ||
          document.querySelector(".room-shell") ||
          document.querySelector(".messenger-layout")
        const box = content?.getBoundingClientRect()
        return {
          width: innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
          leftGap: box ? Math.round(box.left - side.right) : null,
          overflow: [
            ...document.querySelectorAll(
              ".participant-card,.friends-toolbar,.friend-card,.message-compose",
            ),
          ]
            .filter((e) => {
              const b = e.getBoundingClientRect()
              const strip = e.closest(".participant-strip")
              if (strip && getComputedStyle(strip).overflowX === "auto")
                return false
              return b.left < 0 || b.right > innerWidth + 1
            })
            .map((e) => e.className),
        }
      })
      if (layout.scrollWidth > width || layout.overflow.length)
        throw new Error(JSON.stringify({ scene, ...layout }))
      if (scene === "friends" && layout.leftGap < 16)
        throw new Error("Friends needs a gutter " + JSON.stringify(layout))
      if (width === 1024)
        await p.screenshot({
          path: `D:/FreeTalk-gifs/output/playwright/marketing-layout-${scene}-1024.png`,
        })
      report.push({ kind: "app", scene, ...layout })
    }
    for (const count of [1, 2, 4, 8]) {
      await p.evaluate((n) => {
        window.marketing.scene("call")
        window.marketing.roster(n)
      }, count)
      await p.waitForTimeout(250)
      const layout = await p
        .locator(".participants-grid")
        .evaluate((e) => ({
          clientWidth: e.clientWidth,
          scrollWidth: e.scrollWidth,
          cards: [...e.querySelectorAll(".participant-card")].length,
        }))
      if (layout.scrollWidth > layout.clientWidth + 1 || layout.cards !== count)
        throw new Error(JSON.stringify({ width, count, ...layout }))
      report.push({ kind: "roster", width, count, ...layout })
    }
    await context.close()
  }
  return report
}
