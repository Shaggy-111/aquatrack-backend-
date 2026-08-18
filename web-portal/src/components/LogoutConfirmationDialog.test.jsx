import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import LogoutConfirmationDialog from "./LogoutConfirmationDialog";

describe("LogoutConfirmationDialog", () => {
  test("Cancel closes without logging out", () => {
    const onCancel = jest.fn();
    const onConfirm = jest.fn();
    render(<LogoutConfirmationDialog open onCancel={onCancel} onConfirm={onConfirm} />);

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  test("Logout invokes the existing logout callback", () => {
    const onConfirm = jest.fn();
    render(<LogoutConfirmationDialog open onCancel={jest.fn()} onConfirm={onConfirm} />);

    fireEvent.click(screen.getByRole("button", { name: "Logout" }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
