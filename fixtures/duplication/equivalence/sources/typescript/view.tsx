export function View(props: { items: string[]; title: string; onPick: (item: string) => void }) {
  const rows = props.items.map((item, index) => (
    <li key={item} className={index % 2 === 0 ? "even" : "odd"} onClick={() => props.onPick(item)}>
      {item}
    </li>
  ));

  if (rows.length === 0) {
    return <p className="empty">Nothing to show for {props.title}</p>;
  }

  return (
    <section>
      <h2>{props.title}</h2>
      <ul>{rows}</ul>
    </section>
  );
}
