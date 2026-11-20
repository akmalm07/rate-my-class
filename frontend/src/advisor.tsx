import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Selections } from "../../backend/src/cuny/scraper";
import { errorMessage, sendAdvisorGoals, sendAdvisorMessage, type AdvisorMessage, type AdvisorSchedule, type Catalog } from "./api";

const greeting: AdvisorMessage = {
  role: "assistant",
  content: "Hi! What are you interested in studying? A goal or a subject is enough, and it's fine if you're still exploring.",
};

interface AdvisorProps {
  selections?: Selections;
  catalog: Catalog;
  onGoals: () => void;
  onSave: (schedule: AdvisorSchedule) => void;
  onView: (schedule: AdvisorSchedule) => void;
}

export function Advisor({ selections, catalog, onGoals, onSave, onView }: AdvisorProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const isOpen = useRef(false);
  const retry = useRef<{ message: string; term: string; college: string; id: string } | undefined>(undefined);
  const [unread, setUnread] = useState(true);
  const [messages, setMessages] = useState([greeting]);
  const [input, setInput] = useState("");
  const [term, setTerm] = useState("");
  const [college, setCollege] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [schedule, setSchedule] = useState<AdvisorSchedule>();
  const goals = messages[1]?.content;

  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal();
    if (!open && dialog.current?.open) dialog.current.close();
  }, [open]);

  useEffect(() => {
    if (open) bottom.current?.scrollIntoView({ block: "nearest" });
  }, [messages, pending, open, schedule, error]);

  function openChat() {
    if (!goals) {
      setTerm(catalog.term);
      setCollege(catalog.college);
    }
    isOpen.current = true;
    setUnread(false);
    setOpen(true);
  }

  function closeChat() {
    isOpen.current = false;
    setOpen(false);
  }

  function restart() {
    retry.current = undefined;
    setMessages([greeting]);
    setInput("");
    setError("");
    setSchedule(undefined);
  }

  async function send(value: string) {
    const message = value.trim();
    if (!message || pending || (goals && (!term || !college))) return;
    setInput(message);
    const entry: AdvisorMessage = { role: "user", content: message };
    const last = retry.current;
    if (last?.message !== message || last.term !== term || last.college !== college) {
      retry.current = { message, term, college, id: crypto.randomUUID() };
    }
    setPending(true);
    setError("");
    try {
      const result: { message: string; schedule?: AdvisorSchedule } = goals
        ? await sendAdvisorMessage({ term, college }, goals, [...messages.slice(3, 5), ...messages.slice(5).slice(-10), entry], retry.current!.id)
        : await sendAdvisorGoals(message);
      if (!goals) onGoals();
      if (result.schedule) {
        onSave(result.schedule);
        setSchedule(result.schedule);
      }
      setMessages((current) => [...current, entry, { role: "assistant", content: result.message }]);
      setInput("");
      retry.current = undefined;
      if (!isOpen.current) setUnread(true);
    } catch (error) {
      setError(errorMessage(error));
      if (!isOpen.current) setUnread(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <button className="advisor-launcher" type="button" aria-haspopup="dialog"
        aria-label={unread ? "Open AI advisor, unread message" : "Open AI advisor"} onClick={openChat}>
        <span className="advisor-chat-icon" aria-hidden="true">···</span>
        {unread && <span className="advisor-unread" aria-hidden="true" />}
      </button>
      <dialog className="advisor-dialog" ref={dialog} aria-labelledby="advisor-heading" onClose={closeChat}>
        <header className="advisor-header">
          <h2 id="advisor-heading">AI schedule advisor</h2>
          <button className="advisor-close" type="button" aria-label="Close advisor" onClick={closeChat}>×</button>
        </header>
        <div className="advisor-messages" role="log" aria-label="Advisor messages">
          {messages.map(({ role, content }, index) => <p className={`advisor-message ${role}`} key={index}>{content}</p>)}
          {pending && <p className="advisor-progress" role="status">{goals ? "Checking CUNY classes and meeting times…" : "Reading your goals…"}</p>}
          {error && <p className="advisor-error" role="alert">{error}</p>}
          {schedule && (
            <button className="share-button" type="button" onClick={() => {
              closeChat();
              onView(schedule);
            }}>Open saved schedule</button>
          )}
          <div ref={bottom} />
        </div>
        <form className="advisor-composer" onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          void send(input);
        }}>
          {goals && !schedule && (
            <div className="advisor-scope">
              <label className="field">Term
                <select value={term} disabled={pending || messages.length > 3} onChange={(event) => setTerm(event.target.value)} required>
                  <option value="">Select a term</option>
                  {selections?.terms.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
                </select>
              </label>
              <label className="field">College
                <select value={college} disabled={pending || messages.length > 3} onChange={(event) => setCollege(event.target.value)} required>
                  <option value="">Select a college</option>
                  {selections?.colleges.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
                </select>
              </label>
            </div>
          )}
          {!schedule && (
            <label className="field">
              Your message
              <textarea value={input} rows={2} readOnly={pending} autoFocus
                onChange={(event) => setInput(event.target.value)} />
            </label>
          )}
          {!schedule && !input.trim() && (
            <div>
              <button className="text-button" type="button" disabled={pending || Boolean(goals && (!term || !college))}
                onClick={() => void send(goals ? "I'm flexible. Suggest classes for me." : "I'm still exploring.")}>
                {goals ? "Suggest classes for me" : "I'm still exploring"}
              </button>
            </div>
          )}
          <div className="advisor-actions">
            {goals ? <button className="text-button" type="button" disabled={pending} onClick={restart}>Start over</button>
              : <small>Messages are sent to OpenAI for planning.</small>}
            {!schedule && <button className="search-button" type="submit" disabled={pending || !input.trim() || Boolean(goals && (!term || !college))}>Send</button>}
          </div>
        </form>
      </dialog>
    </>
  );
}
