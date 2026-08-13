export interface DaSearchRequest {
  q: string;
  limit?: number;
  offset?: number;
  o?: string;
  test?: boolean;
}

export interface DaSearchResultItem {
  court: string;
  docket: string;
  title: string;
  link: string;
  date_filed: string | null;
}

export interface DaSearchResponse {
  count: number;
  search_results: DaSearchResultItem[];
  success?: boolean;
  error?: string;
}

export interface DaLoginRequest {
  username: string;
  password: string;
}

export interface DaLoginResponse {
  success: boolean;
  login_token?: string;
  error?: string;
}
