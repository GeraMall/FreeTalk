/* global window, document, innerWidth, scrollTo, getComputedStyle */
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
    await p.locator(".tour-video").scrollIntoViewIfNeeded()
    await p.waitForFunction(() => {
      const v = document.querySelector("video")
      return v.readyState >= 2 && !v.paused && v.currentTime > 0
    })
    const video = await p.locator("video").evaluate((v) => ({
      width: v.videoWidth, height: v.videoHeight, duration: v.duration,
      muted: v.muted, loop: v.loop, inline: v.playsInline, autoplay: v.autoplay,
    }))
    if (!video.muted || !video.loop || !video.inline || !video.autoplay)
      throw new Error("Inline silent autoplay not configured")
    await p.locator(".tour-toggle").click()
    if (!(await p.locator("video").evaluate((v) => v.paused)))
      throw new Error("Pause control failed")
    await p.locator(".tour-toggle").click()
    await p.waitForFunction(() => !document.querySelector("video").paused)
    await p.locator("video").evaluate((v) => { v.currentTime = v.duration - .15 })
    await p.waitForFunction(() => document.querySelector("video").currentTime < 2)
    await p.locator("#download").scrollIntoViewIfNeeded()
    await p.waitForFunction(() => document.querySelector("video").paused)
    await p.locator(".tour-video").scrollIntoViewIfNeeded()
    await p.waitForFunction(() => !document.querySelector("video").paused)
    if ([1280, 820, 390].includes(width)) {
      await p.evaluate(() => scrollTo({ top: 0, behavior: "instant" }))
      await p.screenshot({
        path: `D:/FreeTalk-gifs/output/playwright/marketing-landing-${width}.png`,
        fullPage: true,
      })
    }
    if (errors.length) throw new Error(JSON.stringify(errors))
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
