import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import axios from "axios";
import AuthScreen from "./AuthScreen";

const mockNavigate = jest.fn();

jest.mock("axios", () => ({ __esModule: true, default: { post: jest.fn() } }), { virtual: true });
jest.mock("react-router-dom", () => ({ useNavigate: () => mockNavigate }), { virtual: true });
jest.mock("../config", () => ({ API_BASE_URL: "https://api.example.test" }));
jest.mock("../hooks/usePermissions", () => ({ refreshPermissions: jest.fn() }));

describe("AuthScreen password field", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
  });

  test("password is hidden by default and toggles visibility", () => {
    render(<AuthScreen />);
    const password = screen.getByPlaceholderText("Password");

    expect(password.getAttribute("type")).toBe("password");
    expect(password.getAttribute("autocomplete")).toBe("current-password");

    fireEvent.click(screen.getByRole("button", { name: "Show password" }));
    expect(password.getAttribute("type")).toBe("text");

    fireEvent.click(screen.getByRole("button", { name: "Hide password" }));
    expect(password.getAttribute("type")).toBe("password");
  });

  test("Enter submits to API_BASE_URL/auth/login and preserves token handling", async () => {
    axios.post.mockResolvedValue({ data: { access_token: "token", user_role: "employee" } });
    render(<AuthScreen />);

    fireEvent.change(screen.getByPlaceholderText("Email Address"), { target: { value: "employee@example.com" } });
    const password = screen.getByPlaceholderText("Password");
    fireEvent.change(password, { target: { value: "secret" } });
    fireEvent.submit(password.closest("form"));

    await waitFor(() => expect(axios.post).toHaveBeenCalledWith("https://api.example.test/auth/login", {
      username: "employee@example.com",
      password: "secret",
    }));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith("/dashboard/employee"));
    expect(localStorage.getItem("auth_token")).toBe("token");
    expect(localStorage.getItem("userToken")).toBe("token");
    expect(localStorage.getItem("partner_token")).toBe("token");
  });

  test("an HTML frontend response cannot be treated as login success", async () => {
    axios.post.mockResolvedValue({ data: "<!doctype html><html><title>Vite + React</title></html>" });
    render(<AuthScreen />);

    fireEvent.change(screen.getByPlaceholderText("Email Address"), { target: { value: "employee@example.com" } });
    fireEvent.change(screen.getByPlaceholderText("Password"), { target: { value: "secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Login" }));

    await screen.findByText("Login failed. Please try again.");
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(localStorage.getItem("auth_token")).toBeNull();
  });
});
