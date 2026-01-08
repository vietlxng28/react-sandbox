import axios from "axios";
import type { AxiosInstance, AxiosRequestConfig, AxiosResponse } from "axios";

// Phần khai báo các kiểu dữ liệu
// Cấu hình chung cho các API call, gồm đường dẫn, phương thức, thời gian chờ, header và tùy chọn xác thực
export interface ApiConfig {
  endpoint: string; // đường dẫn endpoint
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; // phương thức HTTP
  timeout?: number; // thời gian chờ tối đa
  headers?: Record<string, string>; // header tùy chỉnh
  requireAuth?: boolean; // có cần token hay không
  retryOnAuthFailure?: boolean; // có thử lại khi xác thực thất bại hay không
}

// Payload dùng để gửi dữ liệu lên server
export interface Payload {
  [key: string]: string | number | boolean | null | undefined;
}

// Path parameter dùng để thay thế trong endpoint, ví dụ /user/:id
export interface PathParameter {
  [key: string]: string | number | boolean | null | undefined;
}

// Query parameter sẽ được đưa vào URL sau dấu hỏi
export interface QueryParameter {
  [key: string]: string | number | boolean | null | undefined;
}

// Phần mở rộng AxiosRequestConfig để thêm các trường tùy chỉnh
// Trường requireAuth để đánh dấu request cần token
// Trường _retry để đánh dấu request đã retry hay chưa
interface CustomAxiosRequestConfig extends AxiosRequestConfig {
  requireAuth?: boolean;
  _retry?: boolean;
}

// Tạo một instance của axios với cấu hình mặc định
// Bao gồm baseURL lấy từ biến môi trường, timeout mặc định và header mặc định Content-Type
const axiosInstance: AxiosInstance = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || "",
  timeout: 10000,
  headers: { "Content-Type": "application/json" },
});

// Biến đánh dấu đang refresh token
let isRefreshing = false;

// Hàng đợi lưu các request chờ khi refresh token
let failedQueue: {
  resolve: (token: string) => void;
  reject: (err: any) => void;
}[] = [];

// Hàm xử lý hàng đợi request sau khi refresh token xong
const processQueue = (error: any, token: string | null = null) => {
  failedQueue.forEach(({ resolve, reject }) => {
    if (token) resolve(token);
    else reject(error);
  });
  failedQueue = [];
};

// Request interceptor của axios
// Nếu có token trong localStorage thì thêm vào header Authorization
axiosInstance.interceptors.request.use((config) => {
  const token = localStorage.getItem("access_token");
  if (token) {
    config.headers = config.headers || {};
    config.headers["Authorization"] = `Bearer ${token}`;
  }
  return config;
});

// Response interceptor của axios
// Xử lý lỗi 401, tự động refresh token và retry request
axiosInstance.interceptors.response.use(
  (response) => response, // Nếu response thành công thì trả về luôn
  async (error) => {
    const originalRequest = error.config as CustomAxiosRequestConfig;

    // Nếu lỗi 401, request cần auth và chưa retry
    if (
      error.response?.status === 401 &&
      originalRequest?.requireAuth &&
      !originalRequest._retry
    ) {
      if (!isRefreshing) {
        isRefreshing = true;
        const refreshToken = localStorage.getItem("refresh_token");

        if (!refreshToken) {
          isRefreshing = false;
          return Promise.reject(error);
        }

        try {
          const refreshResponse = await axios.post(
            import.meta.env.VITE_REFRESH_ENDPOINT || "",
            { refreshToken },
            { baseURL: import.meta.env.VITE_API_BASE_URL }
          );

          const newToken = refreshResponse.data?.accessToken;
          if (!newToken) throw new Error("Refresh token response invalid");

          localStorage.setItem("access_token", newToken);
          axiosInstance.defaults.headers[
            "Authorization"
          ] = `Bearer ${newToken}`;

          isRefreshing = false;
          processQueue(null, newToken);
        } catch (err) {
          isRefreshing = false;
          processQueue(err, null);
          return Promise.reject(err);
        }
      }

      return new Promise((resolve, reject) => {
        failedQueue.push({
          resolve: (token: string) => {
            originalRequest.headers = originalRequest.headers || {};
            originalRequest.headers["Authorization"] = `Bearer ${token}`;
            originalRequest._retry = true;
            resolve(axiosInstance(originalRequest));
          },
          reject: (err: any) => reject(err),
        });
      });
    }

    return Promise.reject(error);
  }
);

// Hàm callAPI generic để gọi API
// Tham số gồm cấu hình API, payload, path parameters và query parameters
export const callAPI = async <T = any>(
  apiConfig: ApiConfig,
  payload?: Payload,
  pathParams?: PathParameter,
  queryParams?: QueryParameter
): Promise<T> => {
  let { endpoint } = apiConfig;

  // Thay thế các path parameter trong endpoint
  if (pathParams) {
    Object.entries(pathParams).forEach(([key, value]) => {
      if (value === undefined || value === null) {
        throw new Error(`Missing path param: ${key}`);
      }
      endpoint = endpoint.replace(`:${key}`, String(value));
    });
  }

  // Xử lý query parameters
  const finalQuery = new URLSearchParams();
  if (queryParams) {
    Object.entries(queryParams).forEach(([key, value]) => {
      if (value !== null && value !== undefined) {
        finalQuery.append(key, String(value));
      }
    });
  }

  const finalUrl =
    finalQuery.toString().length > 0
      ? `${endpoint}?${finalQuery.toString()}`
      : endpoint;

  // Cấu hình request cho axios
  const axiosConfig: CustomAxiosRequestConfig = {
    url: finalUrl,
    method: apiConfig.method,
    timeout: apiConfig.timeout ?? 10000,
    headers: { ...(apiConfig.headers || {}) },
    requireAuth: apiConfig.requireAuth,
    _retry: false,
  };

  // Thêm payload vào request
  if (apiConfig.method !== "GET" && payload) {
    axiosConfig.data = payload;
  } else if (apiConfig.method === "GET" && payload) {
    axiosConfig.params = payload;
  }

  // Thực hiện request và trả về dữ liệu
  const response: AxiosResponse<T> = await axiosInstance.request(axiosConfig);
  return response.data;
};
