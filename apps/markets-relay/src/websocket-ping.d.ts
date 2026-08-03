/**
 * Bun's WebSocket client implements the protocol-level ping/pong control
 * frames; the WHATWG interface in lib.dom does not expose them, so they have to
 * be declared here.
 *
 * The upstream keep-alive depends on them. Tiingo answers any application frame
 * it does not recognise with `400 Data was not valid json` and then closes the
 * connection, so a ping is the only traffic the relay can generate that does
 * not end the socket it is meant to be keeping open.
 */
declare global {
  interface WebSocket {
    ping(data?: string | ArrayBufferView | ArrayBufferLike): void;
    pong(data?: string | ArrayBufferView | ArrayBufferLike): void;
  }
}

export {};
