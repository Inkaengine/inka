// A question whose answer is completed from a VOCABULARY the author chose.
//
// Two halves, and they are different jobs:
//
//  - The AUTHOR picks which vocabulary in the sidebar, with the
//    `vocabularySelect` widget (see custom-blocks.md). What is stored is a
//    NAME — `plone.app.vocabularies.Keywords` — not a URL, so content carries
//    no environment's origin.
//
//  - The VISITOR types, and the frontend asks that vocabulary for matches:
//    `@vocabularies/<name>?title=<typed>`. The filter is applied by the server,
//    which is what makes this work for a vocabulary of thousands of suburbs as
//    well as one of five tags. `@vocabularies` is readable anonymously
//    (`zope2.View`), unlike `@sources`, so a public form may use it.
//
// The input is an ordinary text box. Suggestions are an enhancement: with no
// JavaScript someone types the answer and it submits unchanged.
function SuggestBlock({ block, apiPath = '' }) {
  const uid = block['@uid'];
  const [matches, setMatches] = useState([]);
  const [typed, setTyped] = useState(block.value || '');

  useEffect(() => {
    if (!block.suggestFrom || !typed) {
      setMatches([]);
      return undefined;
    }
    let cancelled = false;
    // Ask the server to narrow it — never fetch the whole vocabulary and filter
    // in the browser.
    fetch(
      `${apiPath}/@vocabularies/${encodeURIComponent(block.suggestFrom)}` +
        `?title=${encodeURIComponent(typed)}&b_size=10`,
      { headers: { Accept: 'application/json' } },
    )
      .then((res) => (res.ok ? res.json() : { items: [] }))
      .then((body) => {
        if (!cancelled) setMatches(body.items || []);
      })
      .catch(() => {
        if (!cancelled) setMatches([]);
      });
    return () => {
      cancelled = true;
    };
  }, [apiPath, block.suggestFrom, typed]);

  return (
    <div data-block-uid={uid} className="suggest">
      <label htmlFor={`${uid}-input`} data-edit-text="label">
        {block.label}
      </label>
      <input
        id={`${uid}-input`}
        name="answer"
        type="text"
        value={typed}
        aria-autocomplete="list"
        autoComplete="off"
        onChange={(e) => setTyped(e.target.value)}
      />
      {matches.length > 0 && (
        <ul className="suggest__list">
          {matches.map((item) => (
            <li key={item.token}>
              <button type="button" onClick={() => setTyped(item.title)}>
                {/* The part already typed, marked — so the eye sees what the
                    suggestion adds. */}
                <span>{item.title.slice(0, typed.length)}</span>
                {item.title.slice(typed.length)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
