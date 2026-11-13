/** Where the app is. A desktop app with one window needs no router. */
export type Route =
  | { screen: "environment" }
  | { screen: "projects" }
  | { screen: "create" }
  | { screen: "project"; id: string }
  | { screen: "running" }
  | { screen: "results"; projectId: string; runId: string }
  | { screen: "settings" };

export type Go = (route: Route) => void;
