export type DuplicateReview = { acknowledgement:string; history:{address:string;professor_name:string;campaign_name:string;status:string;submitted:number;sent_at:string|null;scheduled_at:string;active_followups:number}[] };
// Text is assigned with textContent so imported names cannot inject markup.
export async function confirmDuplicateReview(review:DuplicateReview):Promise<boolean>{
 return new Promise(resolve=>{
  const dialog=document.createElement("dialog"); dialog.className="duplicate-dialog"; dialog.setAttribute("aria-label","Previously contacted professors");
  const title=document.createElement("h2");title.textContent="Review duplicate recipients";dialog.append(title);
  const intro=document.createElement("p");intro.textContent=`${new Set(review.history.map(r=>r.address)).size} selected professors have previously contacted or scheduled outreach. Review every match before approving again.`;dialog.append(intro);
  for(const row of review.history){const p=document.createElement("p");p.className=row.status==='cancelled'&&!row.submitted?'feedback':'reply-warning';p.textContent=row.sent_at ? `Professor ${row.professor_name} was previously contacted in ${row.campaign_name} on ${new Date(row.sent_at).toLocaleString()}.` : row.status==='cancelled'&&!row.submitted ? `Professor ${row.professor_name} appeared in a previously cancelled campaign, but no initial email was confirmed sent.` : `Professor ${row.professor_name} (${row.address}) has ${row.submitted?'a previous submission with unconfirmed delivery':'scheduled outreach'} in ${row.campaign_name}.`;dialog.append(p);}

  const label=document.createElement("label"),check=document.createElement("input");check.type="checkbox";label.append(check,document.createTextNode(" I acknowledge every listed recipient and deliberately authorize repeat outreach."));dialog.append(label);
  const change=document.createElement("button"),approve=document.createElement("button");change.textContent="Change Recipients";approve.textContent="Approve Anyway";approve.disabled=true;check.onchange=()=>{approve.disabled=!check.checked;};
  const finish=(answer:boolean)=>{dialog.close();dialog.remove();resolve(answer);};change.onclick=()=>finish(false);approve.onclick=()=>finish(true);dialog.addEventListener("cancel",e=>{e.preventDefault();finish(false);});dialog.append(change,approve);document.body.append(dialog);dialog.showModal();
 });
}
