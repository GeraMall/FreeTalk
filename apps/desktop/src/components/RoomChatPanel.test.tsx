// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { RoomChatPanel } from './RoomChatPanel';
afterEach(cleanup);
it('keeps a failed file draft for retry and prevents duplicate submissions while uploading', async () => {
  let finish!: (sent: boolean) => void;
  const send = vi.fn().mockImplementation(
    () =>
      new Promise<boolean>((resolve) => {
        finish = resolve;
      }),
  );
  const view = render(
    <RoomChatPanel
      messages={[]}
      selfId="me"
      fileToken="token"
      onSend={vi.fn()}
      onSendFile={send}
      onClose={vi.fn()}
    />,
  );
  const file = new File(['document'], 'notes.txt', { type: 'text/plain' });
  fireEvent.change(view.getByLabelText('Прикрепить файл'), { target: { files: [file] } });
  fireEvent.change(view.getByLabelText('Сообщение в чат комнаты'), {
    target: { value: 'Подпись' },
  });
  const submit = view.getByRole('button', { name: 'Отправить сообщение' });
  fireEvent.click(submit);
  fireEvent.click(submit);
  expect(send).toHaveBeenCalledExactlyOnceWith(file, 'Подпись');
  finish(false);
  await waitFor(() => expect(view.getByRole('alert')).toBeTruthy());
  expect(view.getByText('notes.txt')).toBeTruthy();
  expect((view.getByLabelText('Сообщение в чат комнаты') as HTMLTextAreaElement).value).toBe(
    'Подпись',
  );
});
