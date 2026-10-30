import { focusManager, QueryClient } from "@tanstack/react-query";
import {
  isWindowSleeping,
  WINDOW_ACTIVITY_CHANGE_EVENT,
  type WindowActivityChangeDetail,
} from "@/lib/windowActivity";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: true,
      staleTime: 0,
    },
    mutations: {
      retry: false,
    },
  },
});

if (typeof window !== "undefined") {
  focusManager.setFocused(!isWindowSleeping());
  window.addEventListener(WINDOW_ACTIVITY_CHANGE_EVENT, (event: Event) => {
    const detail = (event as CustomEvent<WindowActivityChangeDetail>).detail;
    focusManager.setFocused(!detail.sleeping);
  });
}
