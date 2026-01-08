import type { ApiConfig } from "./apiService";

// interface ApiConfig {
//   endpoint: string;
//   method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
//   timeout?: number;
//   headers?: Record<string, string>;
//   requireAuth?: boolean;
//   retryOnAuthFailure?: boolean;
// }

export const ENDPOINT: Record<string, ApiConfig> = {
  USER: {
    endpoint: "/users",
    method: "GET",
  },
};
