export async function confirmMissingDocuments(
  rows: { address: string }[],
  total: number,
): Promise<boolean> {
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "duplicate-dialog";
    dialog.setAttribute("aria-label", "No documents attached");
    const title = document.createElement("h2");
    title.textContent = "No documents attached";
    dialog.append(title);
    const text = document.createElement("p");
    text.textContent =
      rows.length === total
        ? "You have not attached a CV or any other document to this campaign. Are you sure you want to send these emails without attachments?"
        : `${rows.length} of ${total} initial emails have no attachments.`;
    dialog.append(text);
    for (const row of rows) {
      const p = document.createElement("p");
      p.textContent = row.address;
      dialog.append(p);
    }
    const label = document.createElement("label"),
      check = document.createElement("input");
    check.type = "checkbox";
    label.append(
      check,
      document.createTextNode(
        " I confirm these initial emails should be sent without attachments.",
      ),
    );
    dialog.append(label);
    const attach = document.createElement("button"),
      proceed = document.createElement("button");
    attach.textContent = "Attach Documents";
    proceed.textContent = "Continue Without Attachments";
    proceed.disabled = true;
    check.onchange = () => (proceed.disabled = !check.checked);
    const finish = (answer: boolean) => {
      dialog.close();
      dialog.remove();
      resolve(answer);
    };
    attach.onclick = () => {
      finish(false);
      document
        .querySelector(".attachment-panel")
        ?.scrollIntoView({ behavior: "smooth" });
    };
    proceed.onclick = () => finish(true);
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      finish(false);
    });
    dialog.append(attach, proceed);
    document.body.append(dialog);
    dialog.showModal();
  });
}
