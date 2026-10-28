// A plain sentence for when the server can't start listening.
export function describeListenError(err: NodeJS.ErrnoException, port: number): string {
  if (err.code === 'EADDRINUSE') {
    return `Port ${port} is already in use. Job Registry may already be running: open http://127.0.0.1:${port}/`;
  }
  return `Job Registry couldn't start on port ${port}: ${err.message}`;
}
