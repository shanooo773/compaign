"use client";
import {useEffect,useRef,type ReactNode} from 'react';
import {X,FolderOpen} from 'lucide-react';
import {statusName} from './campaign-model';
export function Badge({status,children}:{status:string;children?:ReactNode}) {return <span className={'status-pill status-'+status}>{children || statusName(status)}</span>;}
export function EmptyState({title,description,action}:{title:string;description:string;action?:ReactNode}) {return <div className="workspace-empty"><FolderOpen size={26} aria-hidden="true"/><h3>{title}</h3><p>{description}</p>{action}</div>;}
export function Dialog({title,children,onClose,busy=false,danger=false}:{title:string;children:ReactNode;onClose:()=>void;busy?:boolean;danger?:boolean}) {
 const ref=useRef<HTMLDialogElement>(null);
 useEffect(()=>{const element=ref.current;element?.showModal();return()=>element?.close();},[]);
 return <dialog ref={ref} className={'workspace-dialog'+(danger?' destructive-dialog':'')} aria-label={title} onCancel={event=>{event.preventDefault();if(!busy)onClose();}} onClick={event=>{if(event.target===event.currentTarget&&!busy)onClose();}}><div className="dialog-title"><h2>{title}</h2><button type="button" className="icon-button" aria-label="Close dialog" disabled={busy} onClick={onClose}><X size={20}/></button></div>{children}</dialog>;
}
export function WorkflowProgress({step}:{step:number}) {return <ol className="workflow-progress" aria-label="Campaign creation progress">{['Campaign details','Add professors','Review emails','Attach documents','Review and approve'].map((name,index)=><li key={name} aria-current={index+1===step?'step':undefined} className={index+1<step?'complete':''}><span>{index+1}</span><span>{name}</span></li>)}</ol>;}
