import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, doc, setDoc, getDoc, onSnapshot } from 'firebase/firestore';

// Exact Firebase project configuration
const firebaseConfig = {
  apiKey: "AIzaSyAgf7qX4HarmphjjhhTcj0m_mW5SzYYGMk",
  authDomain: "run-of-show-790f7.firebaseapp.com",
  projectId: "run-of-show-790f7",
  storageBucket: "run-of-show-790f7.firebasestorage.app",
  messagingSenderId: "459921558596",
  appId: "1:459921558596:web:42113bdfe5e782e2870011",
  measurementId: "G-JXKR1JSF24"
};

let app = null;
let auth = null;
let db = null;
const appId = typeof __app_id !== 'undefined' ? __app_id : 'run-of-show-v2';

try {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
} catch (e) {
  console.warn("Offline fallback mode active:", e);
}

export default function App() {
  const [user, setUser] = useState(null);
  const [syncStatus, setSyncStatus] = useState("Connecting to Cloud...");
  const [currentView, setCurrentView] = useState("list"); // "list" | "editor" | "prompter" | "repo"
  
  // Shows State
  const [showsList, setShowsList] = useState([]);
  const [activeShowId, setActiveShowId] = useState(null);
  
  // Active Show Document State
  const [showTitle, setShowTitle] = useState("Untitled Production");
  const [startTime, setStartTime] = useState("09:00:00");
  const [customColumns, setCustomColumns] = useState(["Audio / Cues", "Video / Slides"]);
  const [rundown, setRundown] = useState([]);
  
  // Reusable Repository
  const [segmentRepo, setSegmentRepo] = useState([]);

  // Teleprompter State
  const [isPrompterPlaying, setIsPrompterPlaying] = useState(false);
  const [prompterSpeed, setPrompterSpeed] = useState(3);
  const prompterRef = useRef(null);
  const scrollTimerRef = useRef(null);

  // 1. Firebase Auth Initialization
  useEffect(() => {
    if (!auth) {
      setSyncStatus("💾 Local Mode");
      loadLocalFallback();
      return;
    }

    signInAnonymously(auth).catch((err) => {
      console.warn("Auth warning:", err);
      setSyncStatus("⚠️ Local Fallback Mode");
      loadLocalFallback();
    });

    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      if (u) setSyncStatus("🟢 Cloud Sync Active");
    });
    return () => unsubscribe();
  }, []);

  // 2. Cloud Data Synchronization (Firestore) with Corrected Even-Segment Document Paths
  useEffect(() => {
    if (!user || !db) return;

    // Listen to Shows List Index (Even path segments: artifacts / {appId} / public / shows_index)
    const indexRef = doc(db, 'artifacts', appId, 'public', 'shows_index');
    const unsubIndex = onSnapshot(indexRef, (snap) => {
      if (snap.exists()) {
        const list = snap.data().shows || [];
        setShowsList(list);
        if (list.length === 0) {
          createDefaultShow();
        } else if (!activeShowId && list.length > 0) {
          setActiveShowId(list[0].id);
        }
      } else {
        createDefaultShow();
      }
    }, (err) => console.error("Index sync error:", err));

    // Listen to Segment Repository (Even path segments: artifacts / {appId} / public / segment_repo)
    const repoRef = doc(db, 'artifacts', appId, 'public', 'segment_repo');
    const unsubRepo = onSnapshot(repoRef, (snap) => {
      if (snap.exists()) {
        setSegmentRepo(snap.data().items || []);
      }
    }, (err) => console.error("Repo sync error:", err));

    return () => {
      unsubIndex();
      unsubRepo();
    };
  }, [user]);

  // 3. Listen to Active Show Document Changes (Even path segments: artifacts / {appId} / public / show_{id})
  useEffect(() => {
    if (!user || !activeShowId || !db) return;

    const showRef = doc(db, 'artifacts', appId, 'public', `show_${activeShowId}`);
    const unsubShow = onSnapshot(showRef, (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        setShowTitle(typeof data.showTitle === 'string' ? data.showTitle : "Untitled Production");
        setStartTime(typeof data.startTime === 'string' ? data.startTime : "09:00:00");
        setCustomColumns(Array.isArray(data.customColumns) ? data.customColumns : ["Audio / Cues", "Video / Slides"]);
        setRundown(Array.isArray(data.rundown) ? data.rundown : []);
      }
    }, (err) => console.error("Show sync error:", err));

    return () => unsubShow();
  }, [user, activeShowId]);

  // Fallbacks for offline / local mode
  const loadLocalFallback = () => {
    try {
      const savedList = localStorage.getItem("ros_shows");
      const savedRepo = localStorage.getItem("ros_repo");
      if (savedRepo) setSegmentRepo(JSON.parse(savedRepo));
      if (savedList) {
        const parsed = JSON.parse(savedList);
        setShowsList(parsed);
        if (parsed.length > 0) {
          setActiveShowId(parsed[0].id);
          loadLocalShow(parsed[0].id);
        } else {
          createNewShowLocal("Opening Gala 2026");
        }
      } else {
        createNewShowLocal("Opening Gala 2026");
      }
    } catch (e) {
      createNewShowLocal("Opening Gala 2026");
    }
  };

  const loadLocalShow = (id) => {
    try {
      const showData = localStorage.getItem(`ros_show_${id}`);
      if (showData) {
        const parsed = JSON.parse(showData);
        setShowTitle(parsed.showTitle);
        setStartTime(parsed.startTime);
        setCustomColumns(parsed.customColumns);
        setRundown(parsed.rundown);
      }
    } catch (e) {}
  };

  const createNewShowLocal = (titleInput = "New Show") => {
    const newId = "show_" + Date.now();
    const newShow = {
      id: newId,
      showTitle: titleInput,
      startTime: "09:00:00",
      customColumns: ["Audio / Cues", "Video / Slides"],
      rundown: [
        { id: "b1", type: "block", title: "BLOCK 1: INTRODUCTION", color: "#1e3a8a" },
        { id: "s1", type: "segment", min: 2, sec: 0, title: "Welcome Remarks", talent: "Host", script: "Welcome everyone to our special presentation today!", customValues: ["Intro music cue", "Slide deck online"], isUpper: false }
      ]
    };
    setActiveShowId(newId);
    setShowsList([{ id: newId, title: titleInput, updatedAt: new Date().toISOString() }]);
    setShowTitle(titleInput);
    setStartTime("09:00:00");
    setCustomColumns(newShow.customColumns);
    setRundown(newShow.rundown);
  };

  const createDefaultShow = async () => {
    createNewShowLocal("Annual Global Conference 2026");
  };

  const persistShow = async (newTitle = showTitle, newStart = startTime, newCols = customColumns, newRundown = rundown) => {
    if (!activeShowId) return;
    const showPayload = {
      id: activeShowId,
      showTitle: newTitle,
      startTime: newStart,
      customColumns: newCols,
      rundown: newRundown,
      updatedAt: new Date().toISOString()
    };

    if (user && db) {
      try {
        await setDoc(doc(db, 'artifacts', appId, 'public', `show_${activeShowId}`), showPayload);
        const indexRef = doc(db, 'artifacts', appId, 'public', 'shows_index');
        const indexSnap = await getDoc(indexRef);
        let list = indexSnap.exists() ? (indexSnap.data().shows || []) : [];
        const idx = list.findIndex(s => s.id === activeShowId);
        if (idx >= 0) {
          list[idx].title = newTitle;
          list[idx].updatedAt = showPayload.updatedAt;
        } else {
          list.push({ id: activeShowId, title: newTitle, updatedAt: showPayload.updatedAt });
        }
        await setDoc(indexRef, { shows: list });
      } catch (err) {
        console.error("Cloud persist error:", err);
      }
    } else {
      try {
        localStorage.setItem(`ros_show_${activeShowId}`, JSON.stringify(showPayload));
        const updatedList = showsList.map(s => s.id === activeShowId ? { ...s, title: newTitle, updatedAt: new Date().toISOString() } : s);
        setShowsList(updatedList);
        localStorage.setItem("ros_shows", JSON.stringify(updatedList));
      } catch (e) {}
    }
  };

  const handleCreateShowPrompt = () => {
    const name = prompt("Enter production title:", "New Production Rundown");
    if (!name) return;
    const newId = "show_" + Date.now();
    const newShow = {
      id: newId,
      showTitle: name,
      startTime: "09:00:00",
      customColumns: ["Audio / Cues", "Video / Slides"],
      rundown: [
        { id: "b1", type: "block", title: "MAIN SECTION", color: "#2563eb" },
        { id: "s1", type: "segment", min: 3, sec: 0, title: "Opening", talent: "Presenter", script: "Type your script here...", customValues: ["", ""], isUpper: false }
      ]
    };

    if (user && db) {
      setDoc(doc(db, 'artifacts', appId, 'public', `show_${newId}`), newShow).then(() => {
        const updated = [...showsList, { id: newId, title: name, updatedAt: new Date().toISOString() }];
        setDoc(doc(db, 'artifacts', appId, 'public', 'shows_index'), { shows: updated });
        setActiveShowId(newId);
        setCurrentView("editor");
      });
    } else {
      createNewShowLocal(name);
      setCurrentView("editor");
    }
  };

  const handleDeleteShow = (id, e) => {
    e.stopPropagation();
    if (!window.confirm("Are you sure you want to delete this show rundown?")) return;
    const updated = showsList.filter(s => s.id !== id);
    if (user && db) {
      setDoc(doc(db, 'artifacts', appId, 'public', 'shows_index'), { shows: updated }).then(() => {
        if (activeShowId === id && updated.length > 0) setActiveShowId(updated[0].id);
      });
    } else {
      setShowsList(updated);
      if (activeShowId === id && updated.length > 0) setActiveShowId(updated[0].id);
      localStorage.setItem("ros_shows", JSON.stringify(updated));
    }
  };

  // Timing Calculation Engine
  const calculateSchedule = () => {
    const parts = startTime.split(":");
    let currentSecs = (parseInt(parts[0]) || 0) * 3600 + (parseInt(parts[1]) || 0) * 60 + (parseInt(parts[2]) || 0);

    return rundown.map(item => {
      if (item.type === "block") return { ...item, calculatedTime: "" };

      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setSeconds(currentSecs);
      const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

      const duration = (parseInt(item.min) || 0) * 60 + (parseInt(item.sec) || 0);
      currentSecs += duration;

      return { ...item, calculatedTime: timeStr };
    });
  };

  const activeTimedRundown = calculateSchedule();

  // Row operations
  const addSegment = () => {
    const item = {
      id: "seg_" + Date.now(),
      type: "segment",
      min: 2,
      sec: 0,
      title: "New Segment",
      talent: "Speaker",
      script: "Enter script remarks...",
      customValues: new Array(customColumns.length).fill(""),
      isUpper: false
    };
    const updated = [...rundown, item];
    setRundown(updated);
    persistShow(showTitle, startTime, customColumns, updated);
  };

  const addCue = () => {
    const item = {
      id: "cue_" + Date.now(),
      type: "cue",
      min: 0,
      sec: 15,
      title: "Cue Roll",
      talent: "AV Control",
      color: "#f59e0b",
      customValues: new Array(customColumns.length).fill("")
    };
    const updated = [...rundown, item];
    setRundown(updated);
    persistShow(showTitle, startTime, customColumns, updated);
  };

  const addBlock = () => {
    const item = {
      id: "blk_" + Date.now(),
      type: "block",
      title: "NEXT SECTION BREAK",
      color: "#0f172a"
    };
    const updated = [...rundown, item];
    setRundown(updated);
    persistShow(showTitle, startTime, customColumns, updated);
  };

  const deleteRow = (index) => {
    const updated = [...rundown];
    updated.splice(index, 1);
    setRundown(updated);
    persistShow(showTitle, startTime, customColumns, updated);
  };

  const moveRow = (index, direction) => {
    const newIdx = index + direction;
    if (newIdx < 0 || newIdx >= rundown.length) return;
    const updated = [...rundown];
    const temp = updated[index];
    updated[index] = updated[newIdx];
    updated[newIdx] = temp;
    setRundown(updated);
    persistShow(showTitle, startTime, customColumns, updated);
  };

  const updateItem = (index, field, value) => {
    const updated = [...rundown];
    updated[index][field] = value;
    setRundown(updated);
    persistShow(showTitle, startTime, customColumns, updated);
  };

  const updateCustomVal = (itemIdx, colIdx, value) => {
    const updated = [...rundown];
    if (!updated[itemIdx].customValues) updated[itemIdx].customValues = new Array(customColumns.length).fill("");
    updated[itemIdx].customValues[colIdx] = value;
    setRundown(updated);
    persistShow(showTitle, startTime, customColumns, updated);
  };

  const addColumn = () => {
    const name = prompt("Enter Custom Column Name (e.g. Lighting, Stage, Props):");
    if (!name) return;
    const newCols = [...customColumns, name];
    setCustomColumns(newCols);
    const newRundown = rundown.map(item => ({
      ...item,
      customValues: [...(item.customValues || []), ""]
    }));
    setRundown(newRundown);
    persistShow(showTitle, startTime, newCols, newRundown);
  };

  const removeColumn = (colIdx) => {
    const newCols = customColumns.filter((_, i) => i !== colIdx);
    setCustomColumns(newCols);
    const newRundown = rundown.map(item => {
      const cv = [...(item.customValues || [])];
      cv.splice(colIdx, 1);
      return { ...item, customValues: cv };
    });
    setRundown(newRundown);
    persistShow(showTitle, startTime, newCols, newRundown);
  };

  // Reusable Repository Actions
  const saveToRepo = (item) => {
    if (item.type === "block") return;
    const repoItem = {
      id: "repo_" + Date.now(),
      title: item.title,
      talent: item.talent,
      min: item.min,
      sec: item.sec,
      script: item.script,
      customValues: item.customValues || []
    };
    const updatedRepo = [...segmentRepo, repoItem];
    setSegmentRepo(updatedRepo);
    if (user && db) {
      setDoc(doc(db, 'artifacts', appId, 'public', 'segment_repo'), { items: updatedRepo })
        .then(() => alert("Segment saved to Reusable Repository!"));
    } else {
      localStorage.setItem("ros_repo", JSON.stringify(updatedRepo));
      alert("Segment saved to Reusable Repository!");
    }
  };

  const insertFromRepo = (repoItem) => {
    const newItem = {
      id: "seg_" + Date.now(),
      type: "segment",
      min: repoItem.min,
      sec: repoItem.sec,
      title: repoItem.title,
      talent: repoItem.talent,
      script: repoItem.script,
      customValues: [...(repoItem.customValues || []), ...new Array(Math.max(0, customColumns.length - (repoItem.customValues?.length || 0))).fill("")],
      isUpper: false
    };
    const updated = [...rundown, newItem];
    setRundown(updated);
    persistShow(showTitle, startTime, customColumns, updated);
  };

  // Teleprompter Auto-Scroll Effect
  useEffect(() => {
    if (isPrompterPlaying) {
      scrollTimerRef.current = setInterval(() => {
        if (prompterRef.current) {
          prompterRef.current.scrollTop += prompterSpeed;
        }
      }, 50);
    } else {
      clearInterval(scrollTimerRef.current);
    }
    return () => clearInterval(scrollTimerRef.current);
  }, [isPrompterPlaying, prompterSpeed]);

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 font-sans p-4 md:p-6">
      
      {/* Top Application Header */}
      <header className="bg-slate-900 text-white px-6 py-4 rounded-2xl mb-6 shadow-xl flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="text-3xl">🎙️</span>
          <div>
            <h1 className="text-xl font-black tracking-tight">Run of Show Studio</h1>
            <p className="text-xs text-emerald-400 font-bold">{syncStatus}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button 
            onClick={() => setCurrentView("list")} 
            className={`px-3.5 py-2 rounded-lg text-sm font-bold transition ${currentView === "list" ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}
          >
            📋 Shows ({showsList.length})
          </button>
          {activeShowId && (
            <button 
              onClick={() => setCurrentView("editor")} 
              className={`px-3.5 py-2 rounded-lg text-sm font-bold transition ${currentView === "editor" ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}
            >
              ✏️ Editor
            </button>
          )}
          <button 
            onClick={() => setCurrentView("repo")} 
            className={`px-3.5 py-2 rounded-lg text-sm font-bold transition ${currentView === "repo" ? 'bg-purple-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}
          >
            📚 Segment Library ({segmentRepo.length})
          </button>
          {activeShowId && (
            <button 
              onClick={() => setCurrentView("prompter")} 
              className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-sm font-bold transition shadow flex items-center gap-1.5"
            >
              📺 Launch Prompter
            </button>
          )}
        </div>
      </header>

      {/* VIEW 1: SHOWS LIST */}
      {currentView === "list" && (
        <main className="max-w-5xl mx-auto">
          <div className="flex justify-between items-center mb-6">
            <div>
              <h2 className="text-2xl font-black">Production Rundowns</h2>
              <p className="text-sm text-slate-500">Manage and create live show rundowns synchronized instantly in the cloud.</p>
            </div>
            <button 
              onClick={handleCreateShowPrompt}
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-xl font-bold text-sm shadow transition flex items-center gap-2"
            >
              + Create New Show
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {showsList.map((show) => (
              <div 
                key={show.id}
                onClick={() => { setActiveShowId(show.id); setCurrentView("editor"); }}
                className={`bg-white p-5 rounded-2xl border transition shadow-sm hover:shadow-md cursor-pointer flex flex-col justify-between ${activeShowId === show.id ? 'border-blue-600 ring-2 ring-blue-600/20' : 'border-slate-200 hover:border-slate-300'}`}
              >
                <div>
                  <div className="flex justify-between items-start gap-2 mb-2">
                    <h3 className="font-bold text-lg text-slate-900 line-clamp-2">{show.title || "Untitled"}</h3>
                    <button 
                      onClick={(e) => handleDeleteShow(show.id, e)}
                      className="text-slate-400 hover:text-rose-600 p-1 text-xs font-bold"
                      title="Delete Show"
                    >
                      ✕
                    </button>
                  </div>
                  <p className="text-xs text-slate-400 mb-4">Updated: {new Date(show.updatedAt || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                </div>
                <div className="flex items-center justify-between pt-3 border-t border-slate-100">
                  <span className="text-xs font-bold text-blue-600">Open Studio →</span>
                  <button 
                    onClick={(e) => { e.stopPropagation(); setActiveShowId(show.id); setCurrentView("prompter"); }}
                    className="bg-emerald-100 hover:bg-emerald-200 text-emerald-800 text-xs px-2.5 py-1 rounded-lg font-bold"
                  >
                    📺 Prompter
                  </button>
                </div>
              </div>
            ))}
          </div>
        </main>
      )}

      {/* VIEW 2: REUSABLE REPOSITORY */}
      {currentView === "repo" && (
        <main className="max-w-5xl mx-auto">
          <div className="mb-6">
            <h2 className="text-2xl font-black">Reusable Segment Repository</h2>
            <p className="text-sm text-slate-500">Save frequently used segments, intros, or interview blocks from any show and instantly inject them into new productions.</p>
          </div>

          {segmentRepo.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-2xl p-12 text-center text-slate-500">
              <p className="text-lg font-semibold mb-1">Your library is currently empty.</p>
              <p className="text-xs">While editing any rundown, click the "💾 Save to Library" button on any segment row.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {segmentRepo.map((item) => (
                <div key={item.id} className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm flex flex-col justify-between">
                  <div>
                    <div className="flex justify-between items-start gap-2 mb-2">
                      <h4 className="font-bold text-base text-slate-900">{item.title}</h4>
                      <button 
                        onClick={() => {
                          const updated = segmentRepo.filter(i => i.id !== item.id);
                          setSegmentRepo(updated);
                          if (user && db) setDoc(doc(db, 'artifacts', appId, 'public', 'segment_repo'), { items: updated });
                          else localStorage.setItem("ros_repo", JSON.stringify(updated));
                        }} 
                        className="text-rose-500 hover:text-rose-700 text-xs font-bold"
                      >
                        Delete
                      </button>
                    </div>
                    <div className="flex gap-4 text-xs text-slate-500 mb-3">
                      <span>⏱️ {item.min}m {item.sec}s</span>
                      {item.talent && <span>🎙️ {item.talent}</span>}
                    </div>
                    <div 
                      dangerouslySetInnerHTML={{ __html: item.script }} 
                      className="text-xs text-slate-600 bg-slate-50 p-3 rounded-xl border border-slate-100 max-h-24 overflow-y-auto mb-4"
                    />
                  </div>
                  {activeShowId && (
                    <button 
                      onClick={() => { insertFromRepo(item); alert(`Added "${item.title}" to active show!`); }}
                      className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold py-2.5 px-3 rounded-xl transition w-full shadow"
                    >
                      + Insert into Active Show
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </main>
      )}

      {/* VIEW 3: LIVE TELEPROMPTER OVERLAY */}
      {currentView === "prompter" && (
        <div className="fixed inset-0 bg-black z-50 p-6 flex flex-col text-white">
          <div className="absolute top-4 right-6 bg-slate-900/95 border border-slate-700 p-3 rounded-xl flex items-center gap-4 shadow-2xl z-50">
            <span className="text-xs px-3 py-1 rounded-full bg-emerald-600 font-bold">🟢 Live Prompter</span>
            <button 
              onClick={() => setIsPrompterPlaying(!isPrompterPlaying)}
              className="bg-blue-600 hover:bg-blue-700 px-4 py-1.5 rounded-lg text-sm font-bold shadow"
            >
              {isPrompterPlaying ? "⏸ Pause" : "▶ Play Scroll"}
            </button>
            <label className="text-xs flex items-center gap-2">
              Speed:
              <input 
                type="range" 
                min="1" 
                max="10" 
                value={prompterSpeed} 
                onChange={(e) => setPrompterSpeed(parseInt(e.target.value))}
                className="cursor-pointer"
              />
            </label>
            <button 
              onClick={() => setCurrentView("editor")}
              className="bg-rose-600 hover:bg-rose-700 text-white px-3 py-1.5 rounded-lg text-xs font-bold"
            >
              Close
            </button>
          </div>

          <div ref={prompterRef} className="flex-1 overflow-y-auto max-w-4xl mx-auto my-20 px-4 text-2xl md:text-3xl leading-relaxed">
            <h1 className="text-4xl font-black text-sky-400 mb-8 pb-4 border-b border-slate-800">{showTitle}</h1>
            {activeTimedRundown.map((item, idx) => {
              if (item.type === "block") {
                return (
                  <div key={idx} style={{ backgroundColor: item.color }} className="p-4 my-8 font-bold text-xl uppercase rounded-xl shadow-lg text-white">
                    {item.title || "SECTION"}
                  </div>
                );
              }
              if (item.type === "cue") {
                return (
                  <div key={idx} style={{ backgroundColor: item.color, color: item.color === "#f59e0b" ? "#0f172a" : "#fff" }} className="p-4 my-6 font-bold rounded-xl shadow text-lg">
                    [CUE {item.calculatedTime}] {item.title || 'Cue'} {item.talent ? `| Target: ${item.talent}` : ''}
                  </div>
                );
              }
              if (item.type === "segment" && item.script && item.script.replace(/<[^>]*>/g, '').trim() !== "") {
                return (
                  <div key={idx} className="mb-10 pb-6 border-b border-slate-800">
                    <div className="text-sky-400 font-bold text-lg mb-1">[{item.calculatedTime}] {item.title || 'Segment'}</div>
                    {item.talent && <div className="text-amber-400 text-base font-semibold mb-3">🎙️ {item.talent}</div>}
                    <div style={{ textTransform: item.isUpper ? 'uppercase' : 'none' }} dangerouslySetInnerHTML={{ __html: item.script }} />
                  </div>
                );
              }
              return null;
            })}
          </div>
        </div>
      )}

      {/* VIEW 4: ACTIVE SHOW EDITOR */}
      {currentView === "editor" && (
        <main className="max-w-7xl mx-auto">
          <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
            <input 
              type="text" 
              value={showTitle} 
              onChange={(e) => { setShowTitle(e.target.value); persistShow(e.target.value, startTime, customColumns, rundown); }}
              className="text-2xl md:text-3xl font-black bg-transparent border border-transparent hover:border-slate-300 focus:border-blue-600 focus:bg-white rounded-xl px-3 py-1.5 flex-1 transition"
              placeholder="Show Title..."
            />
          </div>

          <div className="sticky top-0 z-40 bg-slate-100/95 backdrop-blur py-3 mb-6 flex flex-wrap gap-3 items-center border-b border-slate-200">
            <label className="font-bold flex items-center gap-2 text-sm">
              Start Time: 
              <input 
                type="time" 
                step="1" 
                value={startTime} 
                onChange={(e) => { setStartTime(e.target.value); persistShow(showTitle, e.target.value, customColumns, rundown); }}
                className="px-3 py-1.5 border border-slate-300 rounded-xl text-sm bg-white font-mono"
              />
            </label>
            
            <button onClick={addSegment} className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-3.5 py-2 rounded-xl text-sm shadow transition">+ Add Segment</button>
            <button onClick={addCue} className="bg-amber-600 hover:bg-amber-700 text-white font-bold px-3.5 py-2 rounded-xl text-sm shadow transition">+ Add Cue</button>
            <button onClick={addBlock} className="bg-slate-700 hover:bg-slate-800 text-white font-bold px-3.5 py-2 rounded-xl text-sm shadow transition">+ Add Block</button>
            <button onClick={addColumn} className="bg-blue-500 hover:bg-blue-600 text-white font-bold px-3.5 py-2 rounded-xl text-sm shadow transition">+ Add Column</button>
            <button onClick={() => setCurrentView("prompter")} className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-3.5 py-2 rounded-xl text-sm shadow transition">📺 Prompter</button>
            <button onClick={() => window.print()} className="bg-slate-600 hover:bg-slate-700 text-white font-bold px-3.5 py-2 rounded-xl text-sm shadow transition">📄 Print / PDF</button>
          </div>

          <div className="overflow-x-auto shadow-xl rounded-2xl border border-slate-200 bg-white">
            <table className="w-full border-collapse min-w-[950px]">
              <thead>
                <tr className="bg-slate-900 text-white text-left text-xs uppercase tracking-wider">
                  <th className="p-3.5 w-[100px]">Time</th>
                  <th className="p-3.5 w-[110px]">Duration</th>
                  <th className="p-3.5 w-[160px]">Title</th>
                  <th className="p-3.5 w-[130px]">Talent</th>
                  <th className="p-3.5 w-[320px]">Script & Cues</th>
                  {customColumns.map((col, idx) => (
                    <th key={idx} className="p-3.5 w-[140px]">
                      <div className="flex items-center justify-between gap-2">
                        <span>{col}</span>
                        <button onClick={() => removeColumn(idx)} className="bg-rose-500 hover:bg-rose-700 text-white text-[10px] px-1.5 py-0.5 rounded">✕</button>
                      </div>
                    </th>
                  ))}
                  <th className="p-3.5 w-[140px] text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {activeTimedRundown.map((item, index) => {
                  if (item.type === "block") {
                    const colSpanCount = 6 + customColumns.length;
                    return (
                      <tr key={item.id} style={{ backgroundColor: item.color }}>
                        <td colSpan={colSpanCount} className="p-3">
                          <div className="flex items-center gap-3">
                            <input 
                              type="color" 
                              value={item.color} 
                              onChange={(e) => updateItem(index, 'color', e.target.value)}
                              className="w-7 h-7 rounded border-0 cursor-pointer bg-transparent"
                            />
                            <input 
                              type="text" 
                              value={item.title} 
                              onChange={(e) => updateItem(index, 'title', e.target.value)}
                              className="font-bold text-base text-white bg-white/20 border border-white/30 rounded-xl px-3 py-1 w-full focus:outline-none"
                            />
                          </div>
                        </td>
                        <td className="p-3 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <button onClick={() => moveRow(index, -1)} className="bg-slate-600 text-white text-xs px-2 py-1 rounded">▲</button>
                            <button onClick={() => moveRow(index, 1)} className="bg-slate-600 text-white text-xs px-2 py-1 rounded">▼</button>
                            <button onClick={() => deleteRow(index)} className="bg-rose-600 text-white text-xs px-2 py-1 rounded">Del</button>
                          </div>
                        </td>
                      </tr>
                    );
                  }

                  if (item.type === "cue") {
                    return (
                      <tr key={item.id} style={{ backgroundColor: item.color }} className="transition-colors">
                        <td className="p-3.5 font-mono font-bold text-sm">{item.calculatedTime}</td>
                        <td className="p-3.5">
                          <div className="flex items-center gap-1">
                            <input type="number" value={item.min} min="0" onChange={(e) => updateItem(index, 'min', e.target.value)} className="w-12 text-center p-1 border rounded-lg bg-white text-sm" />m
                            <input type="number" value={item.sec} min="0" max="59" onChange={(e) => updateItem(index, 'sec', e.target.value)} className="w-12 text-center p-1 border rounded-lg bg-white text-sm" />s
                          </div>
                        </td>
                        <td className="p-3.5">
                          <input type="text" value={item.title} onChange={(e) => updateItem(index, 'title', e.target.value)} className="w-full p-1.5 border rounded-lg bg-white text-sm" placeholder="Cue title..." />
                        </td>
                        <td className="p-3.5">
                          <input type="text" value={item.talent} onChange={(e) => updateItem(index, 'talent', e.target.value)} className="w-full p-1.5 border rounded-lg bg-white text-sm" placeholder="Target..." />
                        </td>
                        <td className="p-3.5">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-xs uppercase">Color:</span>
                            <select value={item.color} onChange={(e) => updateItem(index, 'color', e.target.value)} className="p-1 border rounded-lg bg-white text-xs">
                              <option value="#f59e0b">Gold</option>
                              <option value="#10b981">Green</option>
                              <option value="#3b82f6">Blue</option>
                              <option value="#ef4444">Red</option>
                            </select>
                          </div>
                        </td>
                        {customColumns.map((_, colIdx) => (
                          <td key={colIdx} className="p-3.5">
                            <input type="text" value={item.customValues?.[colIdx] || ""} onChange={(e) => updateCustomVal(index, colIdx, e.target.value)} className="w-full p-1.5 border rounded-lg bg-white text-sm" placeholder="Notes..." />
                          </td>
                        ))}
                        <td className="p-3.5 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <button onClick={() => moveRow(index, -1)} className="bg-slate-600 text-white text-xs px-2 py-1 rounded">▲</button>
                            <button onClick={() => moveRow(index, 1)} className="bg-slate-600 text-white text-xs px-2 py-1 rounded">▼</button>
                            <button onClick={() => deleteRow(index)} className="bg-rose-600 text-white text-xs px-2 py-1 rounded">Del</button>
                          </div>
                        </td>
                      </tr>
                    );
                  }

                  return (
                    <tr key={item.id} className="hover:bg-slate-50 transition-colors">
                      <td className="p-3.5 font-mono font-bold text-sm text-slate-700">{item.calculatedTime}</td>
                      <td className="p-3.5">
                        <div className="flex items-center gap-1">
                          <input type="number" value={item.min} min="0" onChange={(e) => updateItem(index, 'min', e.target.value)} className="w-12 text-center p-1 border rounded-lg text-sm" />m
                          <input type="number" value={item.sec} min="0" max="59" onChange={(e) => updateItem(index, 'sec', e.target.value)} className="w-12 text-center p-1 border rounded-lg text-sm" />s
                        </div>
                      </td>
                      <td className="p-3.5">
                        <input type="text" value={item.title} onChange={(e) => updateItem(index, 'title', e.target.value)} className="w-full p-1.5 border rounded-lg text-sm" placeholder="Segment title..." />
                      </td>
                      <td className="p-3.5">
                        <input type="text" value={item.talent} onChange={(e) => updateItem(index, 'talent', e.target.value)} className="w-full p-1.5 border rounded-lg text-sm" placeholder="Talent name..." />
                      </td>
                      <td className="p-3.5">
                        <div className="flex items-center justify-between gap-1 mb-1.5">
                          <div className="flex gap-1">
                            <button onClick={() => document.execCommand('bold')} className="bg-slate-200 hover:bg-slate-300 px-2 py-0.5 text-xs rounded font-bold">B</button>
                            <button onClick={() => document.execCommand('italic')} className="bg-slate-200 hover:bg-slate-300 px-2 py-0.5 text-xs rounded italic">I</button>
                            <button onClick={() => updateItem(index, 'isUpper', !item.isUpper)} className={`px-2 py-0.5 text-xs rounded font-semibold ${item.isUpper ? 'bg-blue-600 text-white' : 'bg-slate-200'}`}>CAPS</button>
                          </div>
                          <button onClick={() => saveToRepo(item)} className="bg-purple-100 hover:bg-purple-200 text-purple-800 text-[10px] font-bold px-2 py-0.5 rounded transition">💾 Save to Library</button>
                        </div>
                        <div 
                          contentEditable={true} 
                          suppressContentEditableWarning={true}
                          onBlur={(e) => updateItem(index, 'script', e.target.innerHTML)}
                          dangerouslySetInnerHTML={{ __html: item.script }}
                          style={{ textTransform: item.isUpper ? 'uppercase' : 'none' }}
                          className="min-h-[60px] p-2.5 border rounded-xl bg-white text-sm outline-none focus:border-blue-600 overflow-y-auto"
                        />
                      </td>
                      {customColumns.map((_, colIdx) => (
                        <td key={colIdx} className="p-3.5">
                          <input type="text" value={item.customValues?.[colIdx] || ""} onChange={(e) => updateCustomVal(index, colIdx, e.target.value)} className="w-full p-1.5 border rounded-lg text-sm" placeholder="Notes..." />
                        </td>
                      ))}
                      <td className="p-3.5 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button onClick={() => moveRow(index, -1)} className="bg-slate-600 text-white text-xs px-2 py-1 rounded">▲</button>
                          <button onClick={() => moveRow(index, 1)} className="bg-slate-600 text-white text-xs px-2 py-1 rounded">▼</button>
                          <button onClick={() => deleteRow(index)} className="bg-rose-600 text-white text-xs px-2 py-1 rounded">Del</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </main>
      )}

    </div>
  );
}
