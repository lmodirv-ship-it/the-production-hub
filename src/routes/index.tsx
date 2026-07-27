import { createFileRoute, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: () => <Navigate to="/studio" />,
  head: () => ({
    meta: [
      { title: "Eco AI Studio" },
      { name: "description", content: "أداة خاصة لتوليد فيديوهات تعريفية بمواقعك على يوتيوب." },
    ],
  }),
});
