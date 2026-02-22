type SSEClient = {
  id: string;
  controller: ReadableStreamDefaultController;
};

class SSEManager {
  private clients: SSEClient[] = [];

  addClient(id: string, controller: ReadableStreamDefaultController) {
    this.clients.push({ id, controller });
  }

  removeClient(id: string) {
    this.clients = this.clients.filter(c => c.id !== id);
  }

  broadcast(event: string, data: unknown) {
    const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    const encoder = new TextEncoder();
    const encoded = encoder.encode(message);

    for (const client of this.clients) {
      try {
        client.controller.enqueue(encoded);
      } catch {
        this.removeClient(client.id);
      }
    }
  }

  get clientCount() {
    return this.clients.length;
  }
}

export const sseManager = new SSEManager();
