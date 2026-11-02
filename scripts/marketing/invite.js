// Playwright CLI evaluates this file as a function expression.
// prettier-ignore
// eslint-disable-next-line @typescript-eslint/no-unused-expressions
;async (page) => {
  await page.goto("http://127.0.0.1:1440/marketing/?scene=call")
  await page.getByRole("button", { name: /Добавить друзей 5/ }).click()
  await page.getByRole("checkbox", { name: "Пригласить Даша" }).check()
  await page.getByRole("textbox", { name: "Поиск друзей для звонка" }).blur()
  await page.mouse.move(5, 5)
  await page
    .getByRole("dialog")
    .screenshot({
      path: "D:/FreeTalk-gifs/output/playwright/marketing-invite.png",
    })
}
