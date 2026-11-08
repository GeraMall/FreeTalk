// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react';
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

const sample = {
  id: '00000000-0000-4000-8000-000000000011',
  participantId: 'me',
  senderName: 'Me',
  text: 'Original',
  timestamp: Date.now(),
};
it('uses a compact room menu for replies, edits, reactions, and confirmed deletion', () => {
  const action = vi.fn(),
    send = vi.fn().mockReturnValue(true);
  const view = render(
    <RoomChatPanel
      messages={[sample]}
      selfId="me"
      onSend={send}
      onAction={action}
      onClose={vi.fn()}
    />,
  );
  const open = () =>
    fireEvent.contextMenu(view.getByText('Original'), { clientX: 100, clientY: 100 });
  open();
  const menu = view.getByRole('menu');
  expect(
    within(menu)
      .getAllByRole('menuitem')
      .map((el) => el.textContent?.trim()),
  ).toEqual(['Ответить', 'Изменить', 'Копировать текст', 'Удалить']);
  for (const name of ['Закрепить', 'Выделить', 'Кто просмотрел', '0 просмотров'])
    expect(within(menu).queryByRole('menuitem', { name })).toBeNull();
  fireEvent.click(within(menu).getByRole('menuitem', { name: 'Ответить' }));
  fireEvent.change(view.getByLabelText('Сообщение в чат комнаты'), { target: { value: 'Reply' } });
  fireEvent.click(view.getByRole('button', { name: 'Отправить сообщение' }));
  expect(send).toHaveBeenCalledWith('Reply', sample.id);
  open();
  fireEvent.click(view.getByRole('menuitem', { name: 'Изменить' }));
  fireEvent.change(view.getByLabelText('Сообщение в чат комнаты'), {
    target: { value: 'Updated' },
  });
  fireEvent.click(view.getByRole('button', { name: 'Отправить сообщение' }));
  expect(action).toHaveBeenCalledWith({ kind: 'edit', id: sample.id, text: 'Updated' });
  open();
  fireEvent.click(view.getByRole('button', { name: 'Поставить реакцию ❤️' }));
  expect(action).toHaveBeenCalledWith({ kind: 'react', id: sample.id, emoji: '❤️' });
  open();
  fireEvent.click(view.getByRole('menuitem', { name: 'Удалить' }));
  expect(action).not.toHaveBeenCalledWith({ kind: 'delete', id: sample.id });
  fireEvent.click(view.getByRole('button', { name: 'Удалить' }));
  expect(action).toHaveBeenCalledWith({ kind: 'delete', id: sample.id });
});
it('never offers editing, deletion, or private readers on another participant’s message', () => {
  const view = render(
    <RoomChatPanel
      messages={[sample]}
      selfId="other"
      onSend={vi.fn()}
      onAction={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  fireEvent.contextMenu(view.getByText('Original'));
  expect(view.getByRole('menuitem', { name: 'Ответить' })).toBeTruthy();
  for (const name of ['Изменить', 'Удалить', '0 просмотров'])
    expect(view.queryByRole('menuitem', { name })).toBeNull();
});

it('keeps own and received reactions below, outside their respective message bubbles', () => {
  const action = vi.fn();
  const view = render(
    <RoomChatPanel
      messages={[
        { ...sample, reactions: [{ emoji: '❤️', userIds: ['other'] }] },
        {
          ...sample,
          id: '00000000-0000-4000-8000-000000000012',
          participantId: 'other',
          text: 'Received',
          reactions: [{ emoji: '👍', userIds: ['me'] }],
        },
      ]}
      selfId="me"
      onSend={vi.fn()}
      onAction={action}
      onClose={vi.fn()}
    />,
  );
  for (const name of ['❤️: 1', '👍: 1']) {
    const reaction = view.getByRole('button', { name });
    expect(reaction.closest('.room-chat-bubble')).toBeNull();
    expect(reaction.closest('.room-chat-message')?.querySelector('.room-chat-bubble')).toBeTruthy();
    expect(
      reaction.closest('.room-chat-message-content')?.querySelector('.room-chat-bubble'),
    ).toBeTruthy();
  }
  fireEvent.click(view.getByRole('button', { name: '👍: 1' }));
  expect(action).toHaveBeenCalledWith({
    kind: 'react',
    id: '00000000-0000-4000-8000-000000000012',
    emoji: '👍',
  });
});
