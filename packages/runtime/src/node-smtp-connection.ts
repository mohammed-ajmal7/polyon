/// <reference types="node" />

import { connect as connectNet, type Socket } from "node:net";
import { connect as connectTls, type TLSSocket } from "node:tls";

import type { SmtpConnection, SmtpConnectionFactory } from "@polyon/integrations";
import type { ValidatedSmtpTransportOptions } from "@polyon/integrations";

const MAX_RESPONSE_BYTES = 64 * 1024;

export class NodeSmtpConnectionFactory implements SmtpConnectionFactory {
  async connect(options: ValidatedSmtpTransportOptions): Promise<SmtpConnection> {
    const socket = options.secure
      ? connectTls({ host: options.host, port: options.port, servername: options.host })
      : connectNet({ host: options.host, port: options.port });

    await waitForConnection(socket, options.connectionTimeoutMs);
    return new NodeSmtpConnection(socket, options.connectionTimeoutMs);
  }
}

class NodeSmtpConnection implements SmtpConnection {
  private buffer = "";
  private socket: Socket | TLSSocket;
  private readonly onDataHandler = (chunk: string) => this.onData(chunk);
  private readonly onErrorHandler = (error: Error) => this.onError(error);
  private readonly onCloseHandler = () =>
    this.onError(new Error("SMTP connection closed unexpectedly."));
  private pendingRead:
    { resolve: (value: string) => void; reject: (error: Error) => void } | undefined;

  constructor(
    socket: Socket | TLSSocket,
    private readonly timeoutMs: number,
  ) {
    this.socket = socket;
    this.bindSocket(socket);
  }

  async startTls(serverName: string, timeoutMs: number): Promise<void> {
    const plainSocket = this.socket;
    this.unbindSocket(plainSocket);

    const tlsSocket = connectTls({ socket: plainSocket, servername: serverName });
    await waitForSecureConnection(tlsSocket, timeoutMs);
    this.socket = tlsSocket;
    this.bindSocket(tlsSocket);
  }

  read(): Promise<string> {
    const newline = this.buffer.indexOf("\n");
    if (newline >= 0) {
      const line = this.buffer.slice(0, newline + 1);
      this.buffer = this.buffer.slice(newline + 1);
      return Promise.resolve(line);
    }

    return new Promise((resolve, reject) => {
      if (this.pendingRead !== undefined) {
        reject(new Error("SMTP connection supports one outstanding read."));
        return;
      }
      this.pendingRead = { resolve, reject };
      this.socket.setTimeout(this.timeoutMs);
      this.socket.once("timeout", () => this.onError(new Error("SMTP connection timed out.")));
    });
  }

  async write(command: string): Promise<void> {
    if (Buffer.byteLength(command, "utf8") > MAX_RESPONSE_BYTES) {
      throw new Error("SMTP command exceeds the configured bound.");
    }

    await new Promise<void>((resolve, reject) => {
      this.socket.write(command, "utf8", (error) => {
        if (error === undefined) resolve();
        else reject(new Error("SMTP write failed."));
      });
    });
  }

  async close(): Promise<void> {
    this.pendingRead?.reject(new Error("SMTP connection closed."));
    this.pendingRead = undefined;
    this.unbindSocket(this.socket);
    this.socket.destroy();
  }

  private bindSocket(socket: Socket | TLSSocket): void {
    socket.setEncoding("utf8");
    socket.on("data", this.onDataHandler);
    socket.on("error", this.onErrorHandler);
    socket.on("close", this.onCloseHandler);
  }

  private unbindSocket(socket: Socket | TLSSocket): void {
    socket.off("data", this.onDataHandler);
    socket.off("error", this.onErrorHandler);
    socket.off("close", this.onCloseHandler);
  }

  private onData(chunk: string): void {
    if (
      Buffer.byteLength(this.buffer, "utf8") + Buffer.byteLength(chunk, "utf8") >
      MAX_RESPONSE_BYTES
    ) {
      this.onError(new Error("SMTP response exceeded the configured bound."));
      return;
    }

    this.buffer += chunk;

    if (this.pendingRead !== undefined && this.buffer.includes("\n")) {
      const pending = this.pendingRead;
      this.pendingRead = undefined;
      this.socket.setTimeout(0);
      const newline = this.buffer.indexOf("\n");
      const line = this.buffer.slice(0, newline + 1);
      this.buffer = this.buffer.slice(newline + 1);
      pending.resolve(line);
    }
  }

  private onError(error: Error): void {
    if (this.pendingRead !== undefined) {
      const pending = this.pendingRead;
      this.pendingRead = undefined;
      pending.reject(error);
    }
  }
}

function waitForConnection(socket: Socket | TLSSocket, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("SMTP connection timed out."));
    }, timeoutMs);

    const fail = () => {
      clearTimeout(timer);
      reject(new Error("SMTP connection failed."));
    };

    socket.once("connect", () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once("secureConnect", () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once("error", fail);
  });
}

function waitForSecureConnection(socket: TLSSocket, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("SMTP STARTTLS negotiation timed out."));
    }, timeoutMs);

    socket.once("secureConnect", () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once("error", () => {
      clearTimeout(timer);
      reject(new Error("SMTP STARTTLS negotiation failed."));
    });
  });
}
