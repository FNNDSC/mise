import { chrisConnection } from "@fnndsc/cumin";

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
}
