import type { CodexBridge } from '../codex/bridge.js';
import { BridgeError } from '../codex/rpc.js';
import {
  generateManualChatBatch,
  ManualChatError,
  type ManualChatBatch,
  prepareManualChatRequest,
  type ManualChatMessage,
  type ManualChatRequest,
  type ManualChatTurn,
} from './chat.js';
import {
  assignPersonaProfiles,
  clonePersonaAssignments,
  type PersonaAssignment,
} from './personality.js';

const HISTORY_TURNS_MAX = 3;

function cloneMessages(messages: readonly ManualChatMessage[]): ManualChatMessage[] {
  return messages.map(({ username, message }) => ({ username, message }));
}

function cloneTurn(turn: ManualChatTurn): ManualChatTurn {
  return { event: turn.event, messages: cloneMessages(turn.messages) };
}

export class ManualChatSession {
  private readonly history: ManualChatTurn[] = [];
  private personas: PersonaAssignment[] = [];
  private isGenerating = false;

  constructor(
    private readonly bridge: Pick<CodexBridge, 'text'>,
    private readonly count = 5,
  ) {}

  getHistory(): ManualChatTurn[] {
    return this.history.map(cloneTurn);
  }

  getPersonas(): PersonaAssignment[] {
    return clonePersonaAssignments(this.personas);
  }

  prepare(event: string): ManualChatRequest {
    return prepareManualChatRequest(event, this.count, this.history, this.personas);
  }

  async generate(event: string, signal?: AbortSignal): Promise<ManualChatBatch> {
    if (this.isGenerating) throw new ManualChatError('session_busy');
    this.isGenerating = true;
    try {
      const result = await generateManualChatBatch(this.bridge, event, {
        count: this.count,
        signal,
        history: this.history,
        personas: this.personas,
      });
      if (signal?.aborted) throw new BridgeError('aborted');
      const stored = { event, messages: cloneMessages(result.messages) };
      const personas = assignPersonaProfiles(
        this.personas,
        result.messages.map(({ username }) => username),
      );
      this.history.push(stored);
      if (this.history.length > HISTORY_TURNS_MAX) this.history.shift();
      this.personas = personas;
      return { ...result, messages: cloneMessages(result.messages) };
    } finally {
      this.isGenerating = false;
    }
  }
}
