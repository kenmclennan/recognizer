export interface RepositoryListingRequest {
  readonly excludeOwnState: boolean;
  readonly onlyPresent: boolean;
  readonly fallback: "walk" | "none";
}

export type RepositoryListing =
  | { readonly from: "git" | "walk"; readonly paths: string[] }
  | { readonly from: "none"; readonly warning: string | null };

export interface RepositoryFiles {
  list(root: string, request: RepositoryListingRequest): RepositoryListing;
}

export const SOURCE_LISTING: RepositoryListingRequest = {
  excludeOwnState: true,
  onlyPresent: false,
  fallback: "walk",
};

export const SETUP_LISTING: RepositoryListingRequest = {
  excludeOwnState: false,
  onlyPresent: true,
  fallback: "walk",
};

export const DETECTION_LISTING: RepositoryListingRequest = {
  excludeOwnState: false,
  onlyPresent: false,
  fallback: "none",
};
