export declare function splitModelRoute(raw: string): { model: string; route: string };
export declare function joinModelRoute(model: string, route?: string): string;
export declare function matchesModel(models: ReadonlySet<string>, model: string, route?: string): boolean;
