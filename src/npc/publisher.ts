import type { ManualChatMessage } from './chat.js';

export const PRESENTATION_MESSAGE_LIMIT = 100;

export type PresentationMessage = Readonly<{ id: string; username: string; message: string }>;
export type PresentationSnapshot = Readonly<{ stream: string; messages: readonly PresentationMessage[] }>;
export type PresentationPublication = (
  messages: readonly ManualChatMessage[],
  signal?: AbortSignal,
) => void | Promise<void>;
type SnapshotListener = (snapshot: PresentationSnapshot) => void;

let streamCounter = 0;

function createStreamId(): string {
  streamCounter += 1;
  return `npc-stream-${streamCounter}-${Math.random().toString(36).slice(2, 10)}`;
}

function copyMessages(messages: readonly PresentationMessage[]): PresentationMessage[] {
  return messages.map(({ id, username, message }) => ({ id, username, message }));
}

export class PresentationPublisher {
  readonly #listeners = new Set<SnapshotListener>();
  readonly #streamId = createStreamId();
  #messages: PresentationMessage[] = [];
  #nextMessageId = 0;

  publish(messages: readonly ManualChatMessage[]): void {
    const revealed = messages.map(({ username, message }) => ({
      id: String(++this.#nextMessageId),
      username,
      message,
    }));
    const next = [...this.#messages, ...revealed];
    this.#messages = next.slice(-PRESENTATION_MESSAGE_LIMIT);
    const snapshot = this.snapshot();
    for (const listener of [...this.#listeners]) listener(snapshot);
  }

  snapshot(): PresentationSnapshot {
    return { stream: this.#streamId, messages: copyMessages(this.#messages) };
  }

  subscribe(listener: SnapshotListener): () => void {
    this.#listeners.add(listener);
    listener(this.snapshot());
    return () => { this.#listeners.delete(listener); };
  }
}
