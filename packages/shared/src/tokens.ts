// Stub for the red step (T011): every export exists so the tests fail on behaviour, not on imports.
const todo = (): never => {
	throw new Error("not implemented");
};
export const TOKEN_BYTES = 0;
export const MAX_LINK_TTL_MS = 0;
export const generateToken = (_random?: (length: number) => Uint8Array): string => todo();
export const hashToken = async (_token: string): Promise<string> => todo();
export const verifyToken = async (_token: string, _hash: string): Promise<boolean> => todo();
export const constantTimeEqual = (_a: string, _b: string): boolean => todo();
// biome-ignore lint/suspicious/noExplicitAny: red-step stub
export const signLink = async (_input: any): Promise<URLSearchParams> => todo();
// biome-ignore lint/suspicious/noExplicitAny: red-step stub
export const verifyLink = async (_input: any): Promise<any> => todo();
