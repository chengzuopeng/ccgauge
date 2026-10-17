export declare function stripModelDecoration(raw: string): string;
export declare function splitModelRoute(raw: string): { model: string; route: string };
export declare function joinModelRoute(model: string, route?: string): string;
export declare function fullModelId(model: string, route?: string): string;
export declare function routedModelTitle(ids: string[]): string | undefined;
export declare function routedModelNames(model: string, route?: string): string[];
export declare function modelRouteIncludes(model: string, route: string | undefined, needle: string): boolean;
export declare function matchesModel(models: ReadonlySet<string>, model: string, route?: string): boolean;
