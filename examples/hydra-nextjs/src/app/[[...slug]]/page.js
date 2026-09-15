import { notFound } from "next/navigation";
import { fetchContent } from "#utils/api";
import { stripPagingSegments } from "#utils/paging";
import PageClient from "./PageClient";

const apiPath = process.env.NEXT_PUBLIC_BACKEND_BASE_URL;

export default async function Page({ params, searchParams }) {
  // Drop the listing's paging segment before asking the API for a path (see
  // #utils/paging) — it addresses a block, not content.
  const slug = stripPagingSegments((await params).slug);
  const path = slug.length ? slug.join('/') : '';

  // Hydra passes the editor's token on the iframe URL, and a frontend is meant
  // to use it — "the same auth token to access the REST API with the same
  // privileges", per the Authentication section of the docs. `fetchContent` has
  // always accepted one; nothing passed it, so every render here was anonymous.
  //
  // Read it from the query because this runs on the SERVER, where
  // getAccessToken() (URL param or sessionStorage, both browser-only) cannot
  // reach. A page is the right place for that: Next gives `searchParams` to
  // pages and deliberately withholds it from layouts, which do not rerender on
  // navigation.
  //
  // Without it, anything that exists only in the editing session is a 404 here
  // — and this catch turns a 404 into notFound(), so the editor renders
  // not-found for the page it is editing. A page just moved in the Contents
  // view is exactly that: the move succeeds, the URL is right, and the iframe
  // shows a 404.
  const token = (await searchParams)?.access_token;

  let data;
  try {
    data = await fetchContent(apiPath, { path, token });
  } catch (error) {
    console.error('Failed to fetch content:', error);
    return notFound();
  }

  if (!data) {
    return notFound();
  }

  return <PageClient initialData={data} apiUrl={apiPath} />;
}
