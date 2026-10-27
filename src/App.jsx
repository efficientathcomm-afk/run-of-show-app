import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, setDoc, getDoc, onSnapshot } from 'firebase/firestore';

// Firebase configuration setup
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
const appId = typeof __app_id !== 'undefined' ? __app_id : 'run-of-show-v3';

try {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
} catch (e) {
  console.warn("Offline fallback mode active:", e);
}

export default function App() {
  const [user, setUser] = useState(null);
  const [syncStatus, setSyncStatus] = useState("Connecting...");
  const [currentView, setCurrentView] = useState("editor"); // "editor" | "list" | "repo" | "prompter"
  const [themeMode, setThemeMode] = useState("dark"); // "dark" | "light"
  
  // Production Shows List State
  const [showsList, setShowsList] = useState([]);
  const [activeShowId, setActiveShowId] = useState(null);
  
  // Active Production State
  const [showTitle, setShowTitle] = useState("Grand Stage Production 2026");
  const [startTime, setStartTime] = useState("09:00:00");
  const [customColumns, setCustomColumns] = useState(["Audio / Cues", "Video / Slides", "Stage Notes"]);
  const [rundown, setRundown] = useState([]);
  
  // Reusable Repository & Modal Editor State
  const [segmentRepo, setSegmentRepo] = useState([]);
  const [editingItemIndex, setEditingItemIndex] = useState(null);
  const [repoSearch, setRepoSearch] = useState("");

  // Drag and Drop State
  const [draggedIndex, setDraggedIndex] = useState(null);

  // Live Production Clocks State
  const [currentTimeStr, setCurrentTimeStr] = useState("");
  const [elapsedShowSeconds, setElapsedShowSeconds] = useState(0);

  // Teleprompter State
  const [isPrompterPlaying, setIsPrompterPlaying] = useState(false);
  const [prompterSpeed, setPrompterSpeed] = useState(3);
  const prompterRef = useRef(null);
  const scrollTimerRef = useRef(null);

  // Live Clock Tick & Show Countdown Engine
  useEffect(() => {
    const timer = setInterval(() => {
      const now = new Date();
      setCurrentTimeStr(now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // 1. Firebase Authentication Initialization
  useEffect(() => {
    if (!auth) {
      setSyncStatus("💾 Local Mode");
      loadLocalFallback();
      return;
    }

    signInAnonymously(auth)
      .then(() => {
        setSyncStatus("🟢 Live Cloud Synced");
      })
      .catch((err) => {
        console.warn("Auth warning:", err);
        setSyncStatus("⚠️ Local Fallback");
        loadLocalFallback();
      });

    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      if (u) setSyncStatus("🟢 Live Cloud Synced");
    });
    return () => unsubscribe();
  }, []);

  // 2. Sync Shows Index & Segment Repo
  useEffect(() => {
    if (!user || !db) return;

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

  // 3. Sync Active Show Document
  useEffect(() => {
    if (!user || !activeShowId || !db) return;

    const showRef = doc(db, 'artifacts', appId, 'public', `show_${activeShowId}`);
    const unsubShow = onSnapshot(showRef, (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        setShowTitle(typeof data.showTitle === 'string' ? data.showTitle : "Untitled Production");
        setStartTime(typeof data.startTime === 'string' ? data.startTime : "09:00:00");
        setCustomColumns(Array.isArray(data.customColumns) ? data.customColumns : ["Audio", "Video"]);
        setRundown(Array.isArray(data.rundown) ? data.rundown : []);
      }
    }, (err) => console.error("Show sync error:", err));

    return () => unsubShow();
  }, [user, activeShowId]);

  const loadLocalFallback = () => {
    try {
      const savedList = localStorage.getItem("ros_shows_v3");
      const savedRepo = localStorage.getItem("ros_repo_v3");
      if (savedRepo) setSegmentRepo(JSON.parse(savedRepo));
      if (savedList) {
        const parsed = JSON.parse(savedList);
        setShowsList(parsed);
        if (parsed.length > 0) {
          setActiveShowId(parsed[0].id);
          loadLocalShow(parsed[0].id);
        } else {
          createNewShowLocal("Grand Stage Gala 2026");
        }
      } else {
        createNewShowLocal("Grand Stage Gala 2026");
      }
    } catch (e) {
      createNewShowLocal("Grand Stage Gala 2026");
    }
  };

  const loadLocalShow = (id) => {
    try {
      const showData = localStorage.getItem(`ros_show_v3_${id}`);
      if (showData) {
        const parsed = JSON.parse(showData);
        setShowTitle(parsed.showTitle);
        setStartTime(parsed.startTime);
        setCustomColumns(parsed.customColumns);
        setRundown(parsed.rundown);
      }
    } catch (e) {}
  };

  const createNewShowLocal = (titleInput = "New Production") => {
    const newId = "show_" + Date.now();
    const newShow = {
      id: newId,
      showTitle: titleInput,
      startTime: "09:00:00",
      customColumns: ["Audio / Cues", "Video / Slides", "Stage Notes"],
      rundown: [
        { id: "b1", type: "block", title: "ACT I: OPENING & WELCOME", color: "#6366f1" },
        { id: "s1", type: "segment", min: 3, sec: 0, title: "Opening Remarks", talent: "Executive Producer", script: "Welcome esteemed guests to our 2026 keynote presentation!", customValues: ["Roll opening intro music", "Main presentation deck active", "Stage lights up full"], isLockedTime: false, lockedTimeStr: "" },
        { id: "c1", type: "cue", min: 0, sec: 15, title: "Roll Hype Video", talent: "AV Control", color: "#f59e0b", customValues: ["Video file: opening_reel_4k.mp4", "Audio preset 2", "Projector main up"], isLockedTime: false, lockedTimeStr: "" }
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
    createNewShowLocal("Grand Stage Gala 2026");
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
        localStorage.setItem(`ros_show_v3_${activeShowId}`, JSON.stringify(showPayload));
        const updatedList = showsList.map(s => s.id === activeShowId ? { ...s, title: newTitle, updatedAt: new Date().toISOString() } : s);
        setShowsList(updatedList);
        localStorage.setItem("ros_shows_v3", JSON.stringify(updatedList));
      } catch (e) {}
    }
  };

  const handleCreateShowPrompt = () => {
    const name = prompt("Enter production title:", "Live Broadcast Production");
    if (!name) return;
    const newId = "show_" + Date.now();
    const newShow = {
      id: newId,
      showTitle: name,
      startTime: "10:00:00",
      customColumns: ["Audio / Cues", "Video / Slides", "Stage Notes"],
      rundown: [
        { id: "b1", type: "block", title: "MAIN SHOW BLOCK", color: "#3b82f6" },
        { id: "s1", type: "segment", min: 2, sec: 0, title: "Introduction", talent: "Host", script: "Opening monologue...", customValues: ["", "", ""], isLockedTime: false, lockedTimeStr: "" }
      ]
    };

    if (user && db) {
      setDoc(doc(db, 'artifacts', appId, 'public', `show_${newId}`), newShow).then(() => {
        const updated = [...showsList, { id: newId, title: name, updatedAt: new Date().toISOString() }];
        setDoc(doc(db, 'artifacts', appId, 'public', 'shows_index'), { shows: updated });
        setActiveShowId(newId);
        setCurrentView("editor");
      }).catch(err => alert("Permission denied. Check Firestore rules."));
    } else {
      createNewShowLocal(name);
      setCurrentView("editor");
    }
  };

  const handleDeleteShow = (id, e) => {
    e.stopPropagation();
    if (!window.confirm("Delete this show rundown permanently?")) return;
    const updated = showsList.filter(s => s.id !== id);
    if (user && db) {
      setDoc(doc(db, 'artifacts', appId, 'public', 'shows_index'), { shows: updated }).then(() => {
        if (activeShowId === id && updated.length > 0) setActiveShowId(updated[0].id);
      });
    } else {
      setShowsList(updated);
      if (activeShowId === id && updated.length > 0) setActiveShowId(updated[0].id);
      localStorage.setItem("ros_shows_v3", JSON.stringify(updated));
    }
  };

  // Timing Calculation & Hard-coded Start Time Engine
  const calculateSchedule = () => {
    const parts = startTime.split(":");
    let currentSecs = (parseInt(parts[0]) || 0) * 3600 + (parseInt(parts[1]) || 0) * 60 + (parseInt(parts[2]) || 0);

    return rundown.map(item => {
      if (item.type === "block") return { ...item, calculatedTime: "" };

      if (item.isLockedTime && item.lockedTimeStr) {
        const lockParts = item.lockedTimeStr.split(":");
        if (lockParts.length >= 2) {
          currentSecs = (parseInt(lockParts[0]) || 0) * 3600 + (parseInt(lockParts[1]) || 0) * 60 + (parseInt(lockParts[2]) || 0);
        }
      }

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

  const totalDurationSeconds = rundown.reduce((acc, item) => {
    if (item.type === "block") return acc;
    return acc + (parseInt(item.min) || 0) * 60 + (parseInt(item.sec) || 0);
  }, 0);
  const totalHours = Math.floor(totalDurationSeconds / 3600);
  const totalMins = Math.floor((totalDurationSeconds % 3600) / 60);
  const totalSecs = totalDurationSeconds % 60;

  // Add Item Actions
  const addSegment = () => {
    const item = {
      id: "seg_" + Date.now(),
      type: "segment",
      min: 3,
      sec: 0,
      title: "New Segment",
      talent: "Presenter",
      script: "Enter script remarks and cue notes here...",
      customValues: new Array(customColumns.length).fill(""),
      isUpper: false,
      isLockedTime: false,
      lockedTimeStr: ""
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
      title: "System Cue / Trigger",
      talent: "AV Control",
      color: "#f59e0b",
      customValues: new Array(customColumns.length).fill(""),
      isLockedTime: false,
      lockedTimeStr: ""
    };
    const updated = [...rundown, item];
    setRundown(updated);
    persistShow(showTitle, startTime, customColumns, updated);
  };

  const addBlock = () => {
    const item = {
      id: "blk_" + Date.now(),
      type: "block",
      title: "SECTION BREAK",
      color: "#475569"
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

  // Drag and Drop Handlers
  const handleDragStart = (e, index) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e, index) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const handleDrop = (e, targetIndex) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === targetIndex) return;
    const updated = [...rundown];
    const [movedItem] = updated.splice(draggedIndex, 1);
    updated.splice(targetIndex, 0, movedItem);
    setDraggedIndex(null);
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
    const name = prompt("Enter Custom Column Name (e.g. Lighting, Stage Props, Prompter Notes):");
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
        .then(() => alert("Saved to Reusable Repository!"))
        .catch(err => alert("Permission denied."));
    } else {
      localStorage.setItem("ros_repo_v3", JSON.stringify(updatedRepo));
      alert("Saved to Reusable Repository!");
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
      isUpper: false,
      isLockedTime: false,
      lockedTimeStr: ""
    };
    const updated = [...rundown, newItem];
    setRundown(updated);
    persistShow(showTitle, startTime, customColumns, updated);
  };

  // Teleprompter Auto-Scroll
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

  const isDark = themeMode === "dark";

  return (
    <div className={`min-h-screen font-sans transition-colors duration-300 ${isDark ? 'bg-slate-950 text-slate-100' : 'bg-slate-50 text-slate-900'} p-3 md:p-6 select-none`}>
      
      {/* Top Professional Control Room Header & Clocks */}
      <header className={`${isDark ? 'bg-slate-900/90 border-slate-800' : 'bg-slate-900 text-white'} backdrop-blur-md px-5 py-4 rounded-2xl mb-6 shadow-2xl flex flex-wrap items-center justify-between gap-4 border`}>
        <div className="flex items-center gap-3.5">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center text-xl shadow-lg">
            🎙️
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg md:text-xl font-black tracking-tight text-white">Run of Show Studio</h1>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-400 border border-blue-500/30">PRO v3.2</span>
            </div>
            <p className="text-xs text-emerald-400 font-medium flex items-center gap-1.5 mt-0.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              {syncStatus}
            </p>
          </div>
        </div>

        {/* Live Production Clocks Banner */}
        <div className="hidden lg:flex items-center gap-6 bg-slate-950/60 px-5 py-2 rounded-xl border border-slate-800">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">Time of Day</div>
            <div className="font-mono text-base font-black text-amber-400">{currentTimeStr || "--:--" }</div>
          </div>
          <div className="w-px h-8 bg-slate-800"></div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">Show Duration</div>
            <div className="font-mono text-base font-black text-sky-400">{totalHours > 0 ? `${totalHours}h ` : ''}{String(totalMins).padStart(2,'0')}m {String(totalSecs).padStart(2,'0')}s</div>
          </div>
        </div>

        {/* Navigation Actions */}
        <div className="flex flex-wrap items-center gap-2">
          <button 
            onClick={() => setCurrentView("list")} 
            className={`px-3.5 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5 ${currentView === "list" ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/30' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}
          >
            📋 Shows ({showsList.length})
          </button>
          {activeShowId && (
            <button 
              onClick={() => setCurrentView("editor")} 
              className={`px-3.5 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5 ${currentView === "editor" ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/30' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}
            >
              ✏️ Rundown Editor
            </button>
          )}
          <button 
            onClick={() => setCurrentView("repo")} 
            className={`px-3.5 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5 ${currentView === "repo" ? 'bg-purple-600 text-white shadow-lg shadow-purple-600/30' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}
          >
            📚 Segment Library ({segmentRepo.length})
          </button>
          {activeShowId && (
            <button 
              onClick={() => setCurrentView("prompter")} 
              className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-xl text-xs font-bold transition shadow-lg shadow-emerald-600/30 flex items-center gap-1.5"
            >
              📺 Teleprompter
            </button>
          )}
          <button 
            onClick={() => setThemeMode(isDark ? 'light' : 'dark')}
            className="bg-slate-800 hover:bg-slate-700 text-amber-400 px-3 py-2 rounded-xl text-xs font-bold transition"
            title="Toggle Light/Dark Theme"
          >
            {isDark ? '☀️' : '🌙'}
          </button>
        </div>
      </header>

      {/* VIEW 1: SHOWS LIST MANAGER */}
      {currentView === "list" && (
        <main className="max-w-6xl mx-auto animate-fade-in">
          <div className="flex justify-between items-center mb-6">
            <div>
              <h2 className="text-2xl font-black">Production Rundowns</h2>
              <p className={`text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Create, manage, and synchronize live event productions across all control rooms.</p>
            </div>
            <button 
              onClick={handleCreateShowPrompt}
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-xl font-bold text-xs shadow-lg shadow-blue-600/20 transition flex items-center gap-2"
            >
              + New Production
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {showsList.map((show) => (
              <div 
                key={show.id}
                onClick={() => { setActiveShowId(show.id); setCurrentView("editor"); }}
                className={`${isDark ? 'bg-slate-900 border-slate-800 hover:border-slate-700' : 'bg-white border-slate-200 hover:border-slate-300'} p-5 rounded-2xl border transition shadow-sm hover:shadow-md cursor-pointer flex flex-col justify-between ${activeShowId === show.id ? 'border-blue-600 ring-2 ring-blue-600/20' : ''}`}
              >
                <div>
                  <div className="flex justify-between items-start gap-2 mb-2">
                    <h3 className={`font-bold text-base line-clamp-2 ${isDark ? 'text-white' : 'text-slate-900'}`}>{show.title || "Untitled"}</h3>
                    <button 
                      onClick={(e) => handleDeleteShow(show.id, e)}
                      className="text-slate-400 hover:text-rose-600 p-1 text-xs font-bold transition"
                      title="Delete Show"
                    >
                      ✕
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-400 mb-4">Updated: {new Date(show.updatedAt || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                </div>
                <div className="flex items-center justify-between pt-3 border-t border-slate-800/10">
                  <span className="text-xs font-bold text-blue-500">Open Studio →</span>
                  <button 
                    onClick={(e) => { e.stopPropagation(); setActiveShowId(show.id); setCurrentView("prompter"); }}
                    className="bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 text-xs px-2.5 py-1 rounded-lg font-bold transition"
                  >
                    📺 Prompter
                  </button>
                </div>
              </div>
            ))}
          </div>
        </main>
      )}

      {/* VIEW 2: REUSABLE SEGMENT LIBRARY */}
      {currentView === "repo" && (
        <main className="max-w-6xl mx-auto animate-fade-in">
          <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
            <div>
              <h2 className="text-2xl font-black">Reusable Segment Repository</h2>
              <p className={`text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Instantly search and inject saved segments into any active production rundown.</p>
            </div>
            <input 
              type="text" 
              placeholder="Search library..." 
              value={repoSearch}
              onChange={(e) => setRepoSearch(e.target.value)}
              className={`px-4 py-2 rounded-xl border text-xs w-64 ${isDark ? 'bg-slate-900 border-slate-800 text-white' : 'bg-white border-slate-200'}`}
            />
          </div>

          {segmentRepo.length === 0 ? (
            <div className={`${isDark ? 'bg-slate-900/50 border-slate-800 text-slate-400' : 'bg-white border-slate-200 text-slate-500'} border rounded-2xl p-12 text-center`}>
              <p className="text-base font-semibold mb-1">Your library is currently empty.</p>
              <p className="text-xs">While editing any rundown, click the "💾 Save to Library" button on any segment row.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {segmentRepo
                .filter(item => item.title.toLowerCase().includes(repoSearch.toLowerCase()) || (item.talent && item.talent.toLowerCase().includes(repoSearch.toLowerCase())))
                .map((item) => (
                <div key={item.id} className={`${isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'} border rounded-2xl p-5 shadow-sm flex flex-col justify-between`}>
                  <div>
                    <div className="flex justify-between items-start gap-2 mb-2">
                      <h4 className={`font-bold text-sm ${isDark ? 'text-white' : 'text-slate-900'}`}>{item.title}</h4>
                      <button 
                        onClick={() => {
                          const updated = segmentRepo.filter(i => i.id !== item.id);
                          setSegmentRepo(updated);
                          if (user && db) setDoc(doc(db, 'artifacts', appId, 'public', 'segment_repo'), { items: updated });
                          else localStorage.setItem("ros_repo_v3", JSON.stringify(updated));
                        }} 
                        className="text-rose-500 hover:text-rose-700 text-xs font-bold"
                      >
                        Delete
                      </button>
                    </div>
                    <div className="flex gap-4 text-xs text-slate-400 mb-3">
                      <span>⏱️ {item.min}m {item.sec}s</span>
                      {item.talent && <span>🎙️ {item.talent}</span>}
                    </div>
                    <div 
                      dangerouslySetInnerHTML={{ __html: item.script }} 
                      className={`text-xs ${isDark ? 'bg-slate-950 text-slate-300 border-slate-800' : 'bg-slate-50 text-slate-600 border-slate-100'} p-3 rounded-xl border max-h-24 overflow-y-auto mb-4`}
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

      {/* VIEW 3: FULLSCREEN TELEPROMPTER */}
      {currentView === "prompter" && (
        <div className="fixed inset-0 bg-black z-50 p-6 flex flex-col text-white animate-fade-in">
          <div className="absolute top-4 right-6 bg-slate-900/95 border border-slate-700 p-3 rounded-2xl flex items-center gap-4 shadow-2xl z-50">
            <span className="text-xs px-3 py-1 rounded-full bg-emerald-600 font-bold">🟢 Live Prompter</span>
            <button 
              onClick={() => setIsPrompterPlaying(!isPrompterPlaying)}
              className="bg-blue-600 hover:bg-blue-700 px-4 py-1.5 rounded-xl text-xs font-bold shadow"
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
                className="cursor-pointer accent-blue-500"
              />
            </label>
            <button 
              onClick={() => setCurrentView("editor")}
              className="bg-rose-600 hover:bg-rose-700 text-white px-3 py-1.5 rounded-xl text-xs font-bold transition"
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

      {/* VIEW 4: MODERN ACTIVE SHOW EDITOR */}
      {currentView === "editor" && (
        <main className="max-w-7xl mx-auto animate-fade-in">
          
          {/* Header & Title Bar */}
          <div className="flex flex-wrap items-center justify-between gap-4 mb-5">
            <input 
              type="text" 
              value={showTitle} 
              onChange={(e) => { setShowTitle(e.target.value); persistShow(e.target.value, startTime, customColumns, rundown); }}
              className={`text-2xl md:text-3xl font-black bg-transparent border border-transparent hover:border-slate-700 focus:border-blue-600 focus:${isDark ? 'bg-slate-900 text-white' : 'bg-white'} rounded-xl px-3.5 py-1.5 flex-1 transition`}
              placeholder="Production Title..."
            />
            <div className={`px-4 py-2 rounded-xl text-xs font-bold border flex items-center gap-2 ${isDark ? 'bg-slate-900 border-slate-800 text-emerald-400' : 'bg-white border-slate-200 text-emerald-600'}`}>
              <span>⏱️ Total Runtime:</span>
              <span className="font-mono">{totalHours > 0 ? `${totalHours}h ` : ''}{totalMins}m {totalSecs}s</span>
            </div>
          </div>

          {/* Sticky Action Toolbar */}
          <div className={`sticky top-0 z-40 ${isDark ? 'bg-slate-950/90 border-slate-800' : 'bg-slate-50/90 border-slate-200'} backdrop-blur-md py-3 mb-6 flex flex-wrap gap-2.5 items-center border-b`}>
            <label className="font-bold flex items-center gap-2 text-xs bg-slate-900 text-white px-3 py-2 rounded-xl shadow">
              Start Time: 
              <input 
                type="time" 
                step="1" 
                value={startTime} 
                onChange={(e) => { setStartTime(e.target.value); persistShow(showTitle, e.target.value, customColumns, rundown); }}
                className="bg-slate-800 text-white px-2 py-1 border border-slate-700 rounded-lg text-xs font-mono"
              />
            </label>
            
            <button onClick={addSegment} className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-3.5 py-2 rounded-xl text-xs shadow-lg shadow-blue-600/20 transition flex items-center gap-1.5">+ Add Segment</button>
            <button onClick={addCue} className="bg-amber-600 hover:bg-amber-700 text-white font-bold px-3.5 py-2 rounded-xl text-xs shadow-lg shadow-amber-600/20 transition flex items-center gap-1.5">+ Add Cue</button>
            <button onClick={addBlock} className="bg-slate-700 hover:bg-slate-800 text-white font-bold px-3.5 py-2 rounded-xl text-xs shadow transition flex items-center gap-1.5">+ Add Section Block</button>
            <button onClick={addColumn} className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-3.5 py-2 rounded-xl text-xs shadow transition flex items-center gap-1.5">+ Add Column</button>
            <button onClick={() => setCurrentView("prompter")} className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-3.5 py-2 rounded-xl text-xs shadow transition flex items-center gap-1.5">📺 Prompter</button>
            <button onClick={() => window.print()} className="bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold px-3.5 py-2 rounded-xl text-xs shadow transition">📄 Print PDF</button>
          </div>

          {/* Rundown Interactive Table */}
          <div className={`overflow-x-auto shadow-2xl rounded-2xl border ${isDark ? 'border-slate-800 bg-slate-900' : 'border-slate-200 bg-white'}`}>
            <table className="w-full border-collapse min-w-[1050px]">
              <thead>
                <tr className="bg-slate-900 text-white text-left text-[11px] uppercase tracking-wider">
                  <th className="p-3.5 w-[50px] text-center">⋮⋮</th>
                  <th className="p-3.5 w-[110px]">Time</th>
                  <th className="p-3.5 w-[110px]">Duration</th>
                  <th className="p-3.5 w-[180px]">Segment / Title</th>
                  <th className="p-3.5 w-[130px]">Talent</th>
                  <th className="p-3.5 w-[340px]">Script & Cue Notes</th>
                  {customColumns.map((col, idx) => (
                    <th key={idx} className="p-3.5 w-[140px]">
                      <div className="flex items-center justify-between gap-2">
                        <span>{col}</span>
                        <button onClick={() => removeColumn(idx)} className="bg-rose-500 hover:bg-rose-700 text-white text-[10px] px-1.5 py-0.5 rounded transition">✕</button>
                      </div>
                    </th>
                  ))}
                  <th className="p-3.5 w-[120px] text-center">Actions</th>
                </tr>
              </thead>
              <tbody className={`divide-y ${isDark ? 'divide-slate-800/80' : 'divide-slate-200'}`}>
                {activeTimedRundown.map((item, index) => {
                  
                  // BLOCK HEADER ROW
                  if (item.type === "block") {
                    const colSpanCount = 7 + customColumns.length;
                    return (
                      <tr 
                        key={item.id} 
                        draggable 
                        onDragStart={(e) => handleDragStart(e, index)}
                        onDragOver={(e) => handleDragOver(e, index)}
                        onDrop={(e) => handleDrop(e, index)}
                        style={{ backgroundColor: item.color }} 
                        className="transition-all hover:brightness-110 cursor-grab active:cursor-grabbing"
                      >
                        <td className="p-3 text-center text-white/70 font-bold">⋮⋮</td>
                        <td colSpan={colSpanCount - 2} className="p-3">
                          <div className="flex items-center gap-3">
                            {/* Modern Sleek Color Picker */}
                            <div className="relative flex items-center">
                              <input 
                                type="color" 
                                value={item.color} 
                                onChange={(e) => updateItem(index, 'color', e.target.value)}
                                className="w-7 h-7 rounded-lg border border-white/30 cursor-pointer bg-transparent opacity-0 absolute inset-0 z-10"
                              />
                              <div style={{ backgroundColor: item.color }} className="w-7 h-7 rounded-lg border border-white/40 shadow-inner flex items-center justify-center text-xs">🎨</div>
                            </div>
                            <input 
                              type="text" 
                              value={item.title} 
                              onChange={(e) => updateItem(index, 'title', e.target.value)}
                              className="font-black text-sm text-white bg-black/20 border border-white/30 rounded-xl px-3.5 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-white/50 transition uppercase tracking-wider"
                              placeholder="SECTION BLOCK TITLE..."
                            />
                          </div>
                        </td>
                        <td className="p-3 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <button onClick={() => moveRow(index, -1)} className="bg-black/30 hover:bg-black/50 text-white text-xs px-2 py-1 rounded-lg">▲</button>
                            <button onClick={() => moveRow(index, 1)} className="bg-black/30 hover:bg-black/50 text-white text-xs px-2 py-1 rounded-lg">▼</button>
                            <button onClick={() => deleteRow(index)} className="bg-rose-600 hover:bg-rose-700 text-white text-xs px-2.5 py-1 rounded-lg font-bold">Del</button>
                          </div>
                        </td>
                      </tr>
                    );
                  }

                  // CUE ROW
                  if (item.type === "cue") {
                    return (
                      <tr 
                        key={item.id} 
                        draggable 
                        onDragStart={(e) => handleDragStart(e, index)}
                        onDragOver={(e) => handleDragOver(e, index)}
                        onDrop={(e) => handleDrop(e, index)}
                        style={{ backgroundColor: item.color }} 
                        className="transition-all hover:brightness-95 cursor-grab active:cursor-grabbing"
                      >
                        <td className="p-3.5 text-center text-slate-700 font-bold">⋮⋮</td>
                        <td className="p-3.5 font-mono font-bold text-xs text-slate-900">{item.calculatedTime}</td>
                        <td className="p-3.5">
                          <div className="flex items-center gap-1 font-mono text-xs">
                            <input type="number" value={item.min} min="0" onChange={(e) => updateItem(index, 'min', e.target.value)} className="w-10 text-center p-1 border rounded-lg bg-white text-slate-900 text-xs shadow-sm" />m
                            <input type="number" value={item.sec} min="0" max="59" onChange={(e) => updateItem(index, 'sec', e.target.value)} className="w-10 text-center p-1 border rounded-lg bg-white text-slate-900 text-xs shadow-sm" />s
                          </div>
                        </td>
                        <td className="p-3.5">
                          <input type="text" value={item.title} onChange={(e) => updateItem(index, 'title', e.target.value)} className="w-full p-2 border rounded-xl bg-white text-slate-900 text-xs font-semibold shadow-sm" placeholder="Cue Title..." />
                        </td>
                        <td className="p-3.5">
                          <input type="text" value={item.talent} onChange={(e) => updateItem(index, 'talent', e.target.value)} className="w-full p-2 border rounded-xl bg-white text-slate-900 text-xs shadow-sm" placeholder="Target / AV..." />
                        </td>
                        <td className="p-3.5">
                          <div className="flex items-center gap-3">
                            <span className="font-bold text-[10px] uppercase text-slate-900">Cue Tone:</span>
                            <div className="flex gap-1.5">
                              {["#f59e0b", "#10b981", "#3b82f6", "#ef4444", "#8b5cf6"].map(c => (
                                <button 
                                  key={c}
                                  onClick={() => updateItem(index, 'color', c)}
                                  style={{ backgroundColor: c }}
                                  className={`w-6 h-6 rounded-lg border-2 shadow transition ${item.color === c ? 'border-slate-900 scale-110' : 'border-white/50'}`}
                                />
                              ))}
                            </div>
                          </div>
                        </td>
                        {customColumns.map((_, colIdx) => (
                          <td key={colIdx} className="p-3.5">
                            <input type="text" value={item.customValues?.[colIdx] || ""} onChange={(e) => updateCustomVal(index, colIdx, e.target.value)} className="w-full p-2 border rounded-xl bg-white text-slate-900 text-xs shadow-sm" placeholder="Notes..." />
                          </td>
                        ))}
                        <td className="p-3.5 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <button onClick={() => moveRow(index, -1)} className="bg-slate-700 text-white text-xs px-2 py-1 rounded-lg">▲</button>
                            <button onClick={() => moveRow(index, 1)} className="bg-slate-700 text-white text-xs px-2 py-1 rounded-lg">▼</button>
                            <button onClick={() => deleteRow(index)} className="bg-rose-600 hover:bg-rose-700 text-white text-xs px-2.5 py-1 rounded-lg font-bold">Del</button>
                          </div>
                        </td>
                      </tr>
                    );
                  }

                  // STANDARD SEGMENT ROW
                  return (
                    <tr 
                      key={item.id} 
                      draggable 
                      onDragStart={(e) => handleDragStart(e, index)}
                      onDragOver={(e) => handleDragOver(e, index)}
                      onDrop={(e) => handleDrop(e, index)}
                      className={`${isDark ? 'hover:bg-slate-800/50' : 'hover:bg-slate-50'} transition-colors cursor-grab active:cursor-grabbing`}
                    >
                      <td className={`p-3.5 text-center font-bold ${isDark ? 'text-slate-600' : 'text-slate-400'}`}>⋮⋮</td>
                      <td className="p-3.5">
                        <div className="flex flex-col gap-1">
                          <span className={`font-mono font-bold text-xs ${isDark ? 'text-emerald-400' : 'text-emerald-600'}`}>{item.calculatedTime}</span>
                          <button 
                            onClick={() => {
                              const newLock = !item.isLockedTime;
                              const updated = [...rundown];
                              updated[index].isLockedTime = newLock;
                              if (newLock) updated[index].lockedTimeStr = item.calculatedTime;
                              setRundown(updated);
                              persistShow(showTitle, startTime, customColumns, updated);
                            }}
                            className={`text-[9px] font-bold px-1.5 py-0.5 rounded transition w-max ${item.isLockedTime ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' : 'bg-slate-800/20 text-slate-400 hover:text-slate-200'}`}
                          >
                            {item.isLockedTime ? '🔒 Hard Start' : '🔓 Auto Time'}
                          </button>
                        </div>
                      </td>
                      <td className="p-3.5">
                        <div className="flex items-center gap-1 font-mono text-xs">
                          <input type="number" value={item.min} min="0" onChange={(e) => updateItem(index, 'min', e.target.value)} className={`w-10 text-center p-1 border rounded-lg text-xs ${isDark ? 'bg-slate-800 border-slate-700 text-white' : ''}`} />m
                          <input type="number" value={item.sec} min="0" max="59" onChange={(e) => updateItem(index, 'sec', e.target.value)} className={`w-10 text-center p-1 border rounded-lg text-xs ${isDark ? 'bg-slate-800 border-slate-700 text-white' : ''}`} />s
                        </div>
                      </td>
                      <td className="p-3.5">
                        <input type="text" value={item.title} onChange={(e) => updateItem(index, 'title', e.target.value)} className={`w-full p-2 border rounded-xl text-xs font-semibold shadow-sm ${isDark ? 'bg-slate-800 border-slate-700 text-white' : 'bg-white border-slate-300 text-slate-900'}`} placeholder="Segment Title..." />
                      </td>
                      <td className="p-3.5">
                        <input type="text" value={item.talent} onChange={(e) => updateItem(index, 'talent', e.target.value)} className={`w-full p-2 border rounded-xl text-xs shadow-sm ${isDark ? 'bg-slate-800 border-slate-700 text-white' : 'bg-white border-slate-300 text-slate-900'}`} placeholder="Talent Name..." />
                      </td>
                      <td className="p-3.5">
                        <div className="flex items-center justify-between gap-1 mb-2">
                          <div className="flex gap-1">
                            <button onClick={() => document.execCommand('bold')} className="bg-slate-800 hover:bg-slate-700 text-white px-2 py-0.5 text-[11px] rounded font-bold shadow">B</button>
                            <button onClick={() => document.execCommand('italic')} className="bg-slate-800 hover:bg-slate-700 text-white px-2 py-0.5 text-[11px] rounded italic shadow">I</button>
                            <button onClick={() => updateItem(index, 'isUpper', !item.isUpper)} className={`px-2 py-0.5 text-[11px] rounded font-semibold shadow ${item.isUpper ? 'bg-blue-600 text-white' : 'bg-slate-800 text-white'}`}>CAPS</button>
                          </div>
                          <button onClick={() => saveToRepo(item)} className="bg-purple-500/10 hover:bg-purple-500/20 text-purple-400 border border-purple-500/20 text-[10px] font-bold px-2 py-0.5 rounded-lg transition">💾 Save to Repo</button>
                        </div>
                        <div 
                          contentEditable={true} 
                          suppressContentEditableWarning={true}
                          onBlur={(e) => updateItem(index, 'script', e.target.innerHTML)}
                          dangerouslySetInnerHTML={{ __html: item.script }}
                          style={{ textTransform: item.isUpper ? 'uppercase' : 'none' }}
                          className={`min-h-[65px] p-2.5 border rounded-xl text-xs outline-none focus:border-blue-600 overflow-y-auto shadow-inner ${isDark ? 'bg-slate-800/80 border-slate-700 text-slate-200' : 'bg-white border-slate-300 text-slate-900'}`}
                        />
                      </td>
                      {customColumns.map((_, colIdx) => (
                        <td key={colIdx} className="p-3.5">
                          <input type="text" value={item.customValues?.[colIdx] || ""} onChange={(e) => updateCustomVal(index, colIdx, e.target.value)} className={`w-full p-2 border rounded-xl text-xs shadow-sm ${isDark ? 'bg-slate-800 border-slate-700 text-white' : 'bg-white border-slate-300 text-slate-900'}`} placeholder="Notes..." />
                        </td>
                      ))}
                      <td className="p-3.5 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button onClick={() => moveRow(index, -1)} className="bg-slate-700 hover:bg-slate-600 text-white text-xs px-2 py-1 rounded-lg">▲</button>
                          <button onClick={() => moveRow(index, 1)} className="bg-slate-700 hover:bg-slate-600 text-white text-xs px-2 py-1 rounded-lg">▼</button>
                          <button onClick={() => deleteRow(index)} className="bg-rose-600 hover:bg-rose-700 text-white text-xs px-2.5 py-1 rounded-lg font-bold">Del</button>
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
