import { streamWebSession, getWebSessionImage, getWebSessionContent } from "@/lib/runtime/client/web";
import type { ContentRef, ImageRef, TranscriptChunk } from "@/types";
import { invoke } from "@/lib/runtime/client/core";
import type { SessionMessage, SessionMeta } from "@/types";

export interface DeleteSessionOptions {
  providerId: string;
  sessionId: string;
  sourcePath: string;
}

export interface DeleteSessionResult extends DeleteSessionOptions {
  success: boolean;
  error?: string;
}

export interface LaunchSessionTerminalOptions {
  command: string;
  cwd?: string | null;
  customConfig?: string | null;
}

export interface BlockContent { text: string; totalLen: number; truncated: boolean; nextOffset?: number }
export const sessionsApi = {
  streamMessages(providerId: string, sourcePath: string, onChunk: (chunk: TranscriptChunk) => void) { return streamWebSession(providerId, sourcePath, onChunk); },
  getBlockContent(providerId: string, sourcePath: string, contentRef: ContentRef, page: {offset?: number; limit?: number} = {}): Promise<BlockContent> { return getWebSessionContent({ providerId, sourcePath, contentRef, ...page }); },
  getImage(providerId: string, sourcePath: string, image: ImageRef) { return getWebSessionImage({ providerId, sourcePath, image }); },
  async exportMarkdown(defaultName: string, content: string): Promise<string | null> {
    const url = URL.createObjectURL(new Blob([content], {type: "text/markdown;charset=utf-8"}));
    const link = document.createElement("a"); link.href = url; link.download = defaultName.replace(/[\\/:*?"<>|]/g, "_"); document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000); return link.download;
  },
  async list(): Promise<SessionMeta[]> {
    return await invoke("list_sessions");
  },

  async getMessages(
    providerId: string,
    sourcePath: string,
  ): Promise<SessionMessage[]> {
    return await invoke("get_session_messages", { providerId, sourcePath });
  },

  async delete(options: DeleteSessionOptions): Promise<boolean> {
    const { providerId, sessionId, sourcePath } = options;
    return await invoke("delete_session", {
      providerId,
      sessionId,
      sourcePath,
    });
  },

  async deleteMany(
    items: DeleteSessionOptions[],
  ): Promise<DeleteSessionResult[]> {
    return await invoke("delete_sessions", { items });
  },

  async launchTerminal(
    options: LaunchSessionTerminalOptions,
  ): Promise<boolean> {
    const { command, cwd, customConfig } = options;
    return await invoke("launch_session_terminal", {
      command,
      cwd,
      customConfig,
    });
  },
};

