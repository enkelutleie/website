import "./header.css";

// Signed-in header: the initial state comes from public/auth-state.js
// (localStorage, before paint). "Logg ut" loads the shared client on demand,
// so pages without login features do not download supabase-js up front.
export const initHeader = () => {
  document.querySelectorAll("[data-sign-out]").forEach((button) => {
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        const { signOut } = await import("./supabase.js");
        await signOut();
      } finally {
        location.assign("/logg-inn/");
      }
    });
  });
};
