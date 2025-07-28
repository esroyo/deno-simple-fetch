import { TimeoutOptions, SendOptions, Agent } from './types.ts';
import { UnexpectedEofError, ConnectionClosedError } from './errors.ts';
import { writeRequest, readResponse } from './http-io.ts';

const PORT_MAP: Record<string, number> = {
  "http:": 80,
  "https:": 443,
};

export function createAgent(baseUrl: string, options: TimeoutOptions = {}): Agent {
  let isConnected = false;
  let isConnecting = false;
  let connection: Deno.Conn | undefined;
  let connectPromise = Promise.withResolvers<void>();
  
  const url = new URL(baseUrl);
  
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Unsupported protocol: ${url.protocol}. Only http: and https: are supported.`);
  }
  
  const hostname = url.hostname;
  const port = url.port ? parseInt(url.port) : PORT_MAP[url.protocol];
  
  if (port === undefined) {
    throw new Error(`Unexpected protocol: ${url.protocol}`);
  }
  
  const connect = async (): Promise<void> => {
    if (isConnected) return;
    if (isConnecting) return connectPromise.promise;
    
    isConnecting = true;
    
    try {
      const connectOptions: Deno.ConnectOptions = {
        port,
        transport: "tcp",
        hostname,
      };
      
      if (url.protocol === "http:") {
        connection = await Deno.connect(connectOptions);
      } else {
        connection = await Deno.connectTls(connectOptions);
      }
      
      isConnected = true;
      isConnecting = false;
      connectPromise.resolve();
    } catch (error) {
      isConnecting = false;
      connectPromise.reject(error);
      throw error;
    }
  };
  
  let isSending = false;
  
  async function send(sendOptions: SendOptions) {
    if (isSending) {
      throw new Error("Cannot send HTTP requests concurrently");
    }
    
    isSending = true;
    
    try {
      if (!isConnected) {
        await connect();
      }
      
      const { path, method, headers, body } = sendOptions;
      const requestUrl = new URL(path, url);
      
      if (!connection) {
        throw new Error("Connection not established");
      }
      
      await writeRequest(connection, {
        url: requestUrl.toString(),
        method,
        headers,
        body,
      });
      
        const response = await readResponse(connection, options);

      return {
        ...response,
        conn: connection,
      };
    } catch (error) {
      if (error instanceof UnexpectedEofError) {
        throw new ConnectionClosedError();
      }
      throw error;
    } finally {
      isSending = false;
    }
  }

    function close() {
        connection?.close();
        connection = undefined;
        isConnected = false;
    }
  
  return {
    [Symbol.dispose]: close,
    close,
    hostname,
    port,
    send,
    get conn(): Deno.Conn | undefined {
      return connection;
    },
  };
}
