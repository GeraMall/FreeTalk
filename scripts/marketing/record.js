/* global window, URL */
// Playwright CLI evaluates this file as a function expression.
// prettier-ignore
// eslint-disable-next-line @typescript-eslint/no-unused-expressions
;async (page) => {
  const browser = page.context().browser()
  const results = []
  for (const scene of ["friends", "chat", "call", "screen"]) {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 1,
      recordVideo: {
        dir: "D:/FreeTalk-gifs/output/marketing/raw",
        size: { width: 1280, height: 800 },
      },
    })
    // A second guard: no external HTTP or WebSocket can leave the recording context.
    await context.route("**/*", (route) =>
      new URL(route.request().url()).hostname === "127.0.0.1"
        ? route.continue()
        : route.abort(),
    )
    await context.routeWebSocket("**/*", (ws) => ws.close())
    const p = await context.newPage()
    const errors = []
    p.on("pageerror", (e) => errors.push(e.message))
    await p.goto(`http://127.0.0.1:1440/marketing/?scene=${scene}`)
    await p.waitForFunction(() => window.marketing)
    await p.waitForTimeout(1200)
    await p.mouse.move(5, 5)
    await p.screenshot({
      path: `D:/FreeTalk-gifs/output/playwright/marketing-${scene}.png`,
    })
    const start = Date.now()
    await p.waitForTimeout(1000)
    if (scene === "friends") {
      const search = p.getByPlaceholder("Найти по @username")
      await search.fill("Аня")
      await p.waitForTimeout(1500)
      await search.fill("")
      await search.blur()
    } else if (scene === "chat") {
      const input = p.getByPlaceholder("Написать сообщение…")
      await input.pressSequentially("Все здесь? Начинаем!", { delay: 55 })
      await input.press("Enter")
      await p.waitForTimeout(800)
      await p.evaluate(() => window.marketing.reply())
    } else if (scene === "call") {
      await p.evaluate(() => window.marketing.react())
    } else {
      await p.mouse.move(900, 680)
      await p.waitForTimeout(1200)
      await p.mouse.move(5, 5)
    }
    await p.waitForTimeout(Math.max(0, 6500 - (Date.now() - start)))
    const video = p.video()
    await context.close()
    await video.saveAs(`D:/FreeTalk-gifs/output/marketing/${scene}.webm`)
    results.push({ scene, errors })
  }
  return results
}
