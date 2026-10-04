/**
 * Page briefs where the choice of block matters: each asks for content with an
 * obviously better and worse presentation (hours as a table, questions as an
 * accordion, things to click through as cards, a comparison side by side…).
 * Images and video are ones the mock API / test frontend can show.
 */
export const BRIEFS = [
  {
    id: 'library',
    title: 'Riverbank Library',
    text: `A landing page for the Riverbank Library.
- Open with a strong welcome that uses the image http://localhost:8888/docs/examples/content-types/image-light.jpg and a "Join the library" button linking to /join.
- Show the three main services so a visitor can click through to each: Borrowing (/services/borrow), Events (/events), Study spaces (/services/study), each with a one-line description.
- Give the opening hours in an easy-to-scan form: Monday–Friday 9am–8pm, Saturday 10am–5pm, Sunday closed.
- Answer two common questions: "Do I need a library card?" (Yes — it's free with photo ID) and "Can I renew books online?" (Yes, up to three times).`,
  },
  {
    id: 'product',
    title: 'Inka Assure',
    text: `A product page for Inka Assure, a compliance add-on.
- A short introduction: Inka Assure records what was checked and signed off on every published version.
- Make it clear that Assure is in beta and features may change.
- A side-by-side comparison of "Without Assure" (warnings are forgotten; no record of sign-off; audits take weeks) and "With Assure" (every check is recorded; sign-offs are tied to versions; audits take minutes).
- A short demo video: http://localhost:8888/docs/static/hydra-demo.mp4/@@download/file
- End with a "Request a demo" button linking to /demo.`,
  },
  {
    id: 'garden',
    title: 'Get involved',
    text: `A "Get involved" page for the Elm Street community garden.
- A short introduction: the garden is run entirely by volunteers and anyone can help.
- Readers should be able to jump to each section of the page from near the top.
- A section "Volunteer days": the next one is Saturday 12 October; feature it prominently with the image http://localhost:8888/docs/examples/content-types/black-starry-night.jpg, a short description and a link to /volunteer.
- A section "Other ways to help" with three options to click through: Donate (/donate), Lend tools (/tools), Spread the word (/share).
- A section "Contact": email garden@example.org.`,
  },
];
