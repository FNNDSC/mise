import { chrisConnection, chrisContext } from "@fnndsc/cumin";

export interface ConnectOptions {
  user: string;
  password: string;
  debug: boolean;
  url: string;
}

export async function connect_do(options: ConnectOptions): Promise<boolean> {
  const token = await chrisConnection.connection_connect(options);
  return token !== null;
}

export async function logout_do(): Promise<void> {
  await chrisConnection.connection_logout();
  // Clear context to show disconnected prompt
  chrisContext.singleContext.user = null;
  chrisContext.singleContext.URL = null;
}
