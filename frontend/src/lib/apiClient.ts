import axios from "axios";

/**
 * Central axios instance for all backend calls. The auth token
 * (added in Phase 2) is attached here via an interceptor so that
 * individual page/query code never has to think about it.
 */
export const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || "http://localhost:4000/api",
  timeout: 15_000,
});

apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem("payguard_token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401 && window.location.pathname !== "/login") {
      // Token missing/expired/invalid — clear it and send the user to
      // login rather than leaving them stuck on a broken page.
      localStorage.removeItem("payguard_token");
      window.location.href = "/login";
    }
    return Promise.reject(error);
  }
);
