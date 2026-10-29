import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, setDoc, getDoc, onSnapshot } from 'firebase/firestore';

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
const appId = typeof __app_id !== 'undefined' ? __app_id : 'run-of-show-studio-v6';

try {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
} catch (e) {
  console.warn("Offline fallback mode active:", e);
}

// Utility to completely strip conflicting inline font sizes/styles from pasted text for the teleprompter
function sanitizeScriptHtml(html) {
  if (!html) return "";
  const div = document.createElement('div');
  div.innerHTML = html;
  const allElements = div.querySelectorAll('*');
  allElements.forEach(el => {
    el.removeAttribute('style');
    el.removeAttribute('face');
    el.removeAttribute('size');
  });
  return div.innerHTML;
}

// Auto-resizing textarea component for all table fields
function AutoTextarea({ value, onChange, placeholder, className, rows = 1 }) {
  const textareaRef = useRef(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [value]);

  return (
    <textarea
      ref={textareaRef}
      rows={rows}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      className={`${className} overflow-hidden resize-none transition-all`}
    />
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [syncStatus, setSyncStatus] = useState("Connecting...");
  const [currentView, setCurrentView] = useState("editor"); // "editor" | "list" | "repo" | "prompter" | "producer"
  const [themeMode, setThemeMode] = useState("light"); // "dark" | "light"
  
  // Production Shows List State
  const [showsList, setShowsList] = useState([]);
  const [activeShowId, setActiveShowId] = useState(null);
  
  // Active Production State
  const [showTitle, setShowTitle] = useState("Grand Stage Production 2026");
  const [startTime, setStartTime] = useState("09:00:00");
  const [customColumns, setCustomColumns] = useState(["Audio / Cues", "Video / Slides", "Stage Notes"]);
  const [rundown, setRundown] = useState([]);
  
  // Reusable Repository State
  const [segmentRepo, setSegmentRepo] = useState([]);
  const [repoSearch, setRepoSearch] = useState("");
  const [editingRepoItem, setEditingRepoItem] = useState(null);

  // Drag and Drop State
  const [draggedIndex, setDraggedIndex] = useState(null);

  // Live Production Clocks State
  const [currentTimeStr, setCurrentTimeStr] = useState("");
  const [nowTimestamp, setNowTimestamp] = useState(Date.now());

  // Teleprompter & Producer Mode State
  const [isPrompterPlaying, setIsPrompterPlaying] = useState(false);
  const [prompterSpeed, setPrompterSpeed] = useState(3);
  const [prompterFontSize, setPrompterFontSize] = useState(36); // px
  const [activeProducerIndex, setActiveProducerIndex] = useState(0);
  const [syncPrompterWithProducer, setSyncPrompterWithProducer] = useState(true);
  
  const prompterRef = useRef(null);
  const scrollTimerRef = useRef(null);
  const prompterItemRefs = useRef({});

  // Active Duration Popup State (itemID -> boolean)
  const [openDurationPopup, setOpenDurationPopup] = useState(null);

  // Live Clock Tick Engine
  useEffect(() => {
    const timer = setInterval(() => {
      const now = new Date();
      setCurrentTimeStr(now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
      setNowTimestamp(now.getTime());
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

    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
        setSyncStatus("🟢 Live Cloud Synced");
      } catch (err) {
        console.warn("Auth warning:", err);
        setSyncStatus("⚠️ Local Fallback");
        loadLocalFallback();
      }
    };
    initAuth();

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
      const savedList = localStorage.getItem("ros_shows_v6");
      const savedRepo = localStorage.getItem("ros_repo_v6");
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
      const showData = localStorage.getItem(`ros_show_v6_${id}`);
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
        { id: "b1", type: "block", title: "ACT I: OPENING & WELCOME", color: "#3b82f6" },
        { id: "s1", type: "segment", min: 1, sec: 0, title: "Opening Remarks", talent: "Executive Producer", script: "", customValues: ["", "", ""], isLockedTime: false, lockedTimeStr: "" },
        { id: "c1", type: "cue", min: 0, sec: 15, title: "Roll Hype Video", talent: "AV Control", color: "#f59e0b", customValues: ["", "", ""], isLockedTime: false, lockedTimeStr: "" }
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

    // Always mirror locally as a fail-safe backup
    try {
      localStorage.setItem(`ros_show_backup_${activeShowId}`, JSON.stringify(showPayload));
    } catch (e) {}

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
        await setDoc(indexRef, { shows: list }, { merge: true });
      } catch (err) {
        console.error("Cloud persist error:", err);
      }
    } else {
      try {
        localStorage.setItem(`ros_show_v6_${activeShowId}`, JSON.stringify(showPayload));
        const updatedList = showsList.map(s => s.id === activeShowId ? { ...s, title: newTitle, updatedAt: new Date().toISOString() } : s);
        setShowsList(updatedList);
        localStorage.setItem("ros_shows_v6", JSON.stringify(updatedList));
      } catch (e) {}
    }
  };

  // Export Show JSON Backup
  const exportShowJson = () => {
    const showData = {
      showTitle,
      startTime,
      customColumns,
      rundown,
      exportedAt: new Date().toISOString()
    };
    const blob = new Blob([JSON.stringify(showData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${showTitle.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_backup.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Import Show JSON Backup
  const importShowJson = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const imported = JSON.parse(event.target.result);
        if (!imported.showTitle || !Array.isArray(imported.rundown)) {
          alert("Invalid rundown backup format.");
          return;
        }
        const newId = "show_" + Date.now();
        setActiveShowId(newId);
        setShowTitle(imported.showTitle + " (Imported)");
        setStartTime(imported.startTime || "09:00:00");
        setCustomColumns(imported.customColumns || ["Audio / Cues", "Video / Slides", "Stage Notes"]);
        setRundown(imported.rundown);
        
        const newShowEntry = { id: newId, title: imported.showTitle + " (Imported)", updatedAt: new Date().toISOString() };
        const updatedList = [...showsList, newShowEntry];
        setShowsList(updatedList);

        if (user && db) {
          setDoc(doc(db, 'artifacts', appId, 'public', `show_${newId}`), {
            id: newId,
            showTitle: imported.showTitle + " (Imported)",
            startTime: imported.startTime || "09:00:00",
            customColumns: imported.customColumns || ["Audio", "Video"],
            rundown: imported.rundown,
            updatedAt: new Date().toISOString()
          });
          setDoc(doc(db, 'artifacts', appId, 'public', 'shows_index'), { shows: updatedList }, { merge: true });
        } else {
          localStorage.setItem("ros_shows_v6", JSON.stringify(updatedList));
        }
        alert("Rundown successfully imported!");
      } catch (err) {
        alert("Failed to parse JSON file.");
      }
    };
    reader.readAsText(file);
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
        { id: "s1", type: "segment", min: 1, sec: 0, title: "Introduction", talent: "Host", script: "", customValues: ["", "", ""], isLockedTime: false, lockedTimeStr: "" }
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
      localStorage.setItem("ros_shows_v6", JSON.stringify(updated));
    }
  };

  // Timing Calculation Engine with Hard-Start support
  const calculateSchedule = () => {
    const parts = startTime.split(":");
    let currentSecs = (parseInt(parts[0]) || 0) * 3600 + (parseInt(parts[1]) || 0) * 60 + (parseInt(parts[2]) || 0);

    return rundown.map((item, index) => {
      if (item.type === "block") return { ...item, calculatedTime: "", rawSeconds: currentSecs, index };

      if (item.isLockedTime && item.lockedTimeStr) {
        const lockParts = item.lockedTimeStr.split(":");
        if (lockParts.length >= 2) {
          currentSecs = (parseInt(lockParts[0]) || 0) * 3600 + (parseInt(lockParts[1]) || 0) * 60 + (parseInt(lockParts[2]) || 0);
        }
      }

      const rawSeconds = currentSecs;
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setSeconds(currentSecs);
      const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

      const duration = (parseInt(item.min) || 0) * 60 + (parseInt(item.sec) || 0);
      currentSecs += duration;

      return { ...item, calculatedTime: timeStr, rawSeconds, index };
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
      min: 1,
      sec: 0,
      title: "",
      talent: "",
      script: "",
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
      title: "",
      talent: "",
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
      color: "#3b82f6"
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

  // Repository & Global Sync Logic
  const saveToRepo = (item) => {
    if (item.type === "block") return;
    const repoItem = {
      id: item.repoId || ("repo_" + Date.now()),
      title: item.title,
      talent: item.talent,
      min: item.min,
      sec: item.sec,
      script: item.script,
      customValues: item.customValues || []
    };
    
    const updatedRundown = rundown.map((seg) => {
      if (seg === item) return { ...seg, repoId: repoItem.id };
      return seg;
    });
    setRundown(updatedRundown);

    const existingIdx = segmentRepo.findIndex(r => r.id === repoItem.id);
    let updatedRepo;
    if (existingIdx >= 0) {
      updatedRepo = [...segmentRepo];
      updatedRepo[existingIdx] = repoItem;
    } else {
      updatedRepo = [...segmentRepo, repoItem];
    }

    setSegmentRepo(updatedRepo);
    persistShow(showTitle, startTime, customColumns, updatedRundown);

    if (user && db) {
      setDoc(doc(db, 'artifacts', appId, 'public', 'segment_repo'), { items: updatedRepo })
        .then(() => alert("Saved & linked to Reusable Repository!"))
        .catch(err => alert("Permission denied."));
    } else {
      localStorage.setItem("ros_repo_v6", JSON.stringify(updatedRepo));
      alert("Saved & linked to Reusable Repository!");
    }
  };

  const insertFromRepo = (repoItem) => {
    const newItem = {
      id: "seg_" + Date.now(),
      repoId: repoItem.id,
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

  const updateRepoItemMaster = async (updatedRepoItem, syncToActiveShow = false) => {
    const updatedRepo = segmentRepo.map(i => i.id === updatedRepoItem.id ? updatedRepoItem : i);
    setSegmentRepo(updatedRepo);
    setEditingRepoItem(null);

    if (syncToActiveShow) {
      const updatedRundown = rundown.map(item => {
        if (item.repoId === updatedRepoItem.id) {
          return {
            ...item,
            title: updatedRepoItem.title,
            talent: updatedRepoItem.talent,
            min: updatedRepoItem.min,
            sec: updatedRepoItem.sec,
            script: updatedRepoItem.script
          };
        }
        return item;
      });
      setRundown(updatedRundown);
      persistShow(showTitle, startTime, customColumns, updatedRundown);
    }

    if (user && db) {
      try {
        await setDoc(doc(db, 'artifacts', appId, 'public', 'segment_repo'), { items: updatedRepo });
        alert("Master segment updated successfully!");
      } catch (e) {
        console.error("Repo update error:", e);
      }
    } else {
      localStorage.setItem("ros_repo_v6", JSON.stringify(updatedRepo));
      alert("Master segment updated successfully!");
    }
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

  // Handle Producer Sync to Prompter
  useEffect(() => {
    if (syncPrompterWithProducer && currentView === "prompter") {
      const activeEl = prompterItemRefs.current[activeProducerIndex];
      if (activeEl && prompterRef.current) {
        prompterRef.current.scrollTo({
          top: activeEl.offsetTop - 100,
          behavior: 'smooth'
        });
      }
    }
  }, [activeProducerIndex, syncPrompterWithProducer, currentView]);

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
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-400 border border-blue-500/30">PRO v6.0</span>
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
            <>
              <button 
                onClick={() => { setActiveProducerIndex(0); setCurrentView("producer"); }} 
                className={`px-3.5 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5 ${currentView === "producer" ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}
              >
                ⏱️ Producer View
              </button>
              <button 
                onClick={() => { setActiveProducerIndex(0); setCurrentView("prompter"); }} 
                className={`px-3.5 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5 ${currentView === "prompter" ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-600/30' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}
              >
                📺 Teleprompter
              </button>
            </>
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
                      className="w-7 h-7 rounded-full bg-slate-800 hover:bg-rose-600 text-slate-300 hover:text-white flex items-center justify-center text-xs font-bold transition"
                      title="Delete Show"
                    >
                      ✕
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-400 mb-4">Updated: {new Date(show.updatedAt || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                </div>
                <div className="flex items-center justify-between pt-3 border-t border-slate-800/10">
                  <span className="text-xs font-bold text-blue-500">Open Studio →</span>
                  <div className="flex gap-2">
                    <button 
                      onClick={(e) => { e.stopPropagation(); setActiveShowId(show.id); setActiveProducerIndex(0); setCurrentView("producer"); }}
                      className="bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 text-xs px-2.5 py-1 rounded-lg font-bold transition"
                    >
                      ⏱️ Producer
                    </button>
                    <button 
                      onClick={(e) => { e.stopPropagation(); setActiveShowId(show.id); setActiveProducerIndex(0); setCurrentView("prompter"); }}
                      className="bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 text-xs px-2.5 py-1 rounded-lg font-bold transition"
                    >
                      📺 Prompter
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </main>
      )}

      {/* VIEW 2: SEGMENT LIBRARY WITH MASTER EDIT & SYNC */}
      {currentView === "repo" && (
        <main className="max-w-6xl mx-auto animate-fade-in">
          <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
            <div>
              <h2 className="text-2xl font-black">Reusable Segment Repository</h2>
              <p className={`text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Edit shared segments globally and push updates across all connected shows.</p>
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
                      <div className="flex items-center gap-2">
                        <h4 className={`font-bold text-sm ${isDark ? 'text-white' : 'text-slate-900'}`}>{item.title}</h4>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-purple-500/20 text-purple-400 border border-purple-500/30">Master Segment</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <button 
                          onClick={() => setEditingRepoItem({ ...item })} 
                          className="w-7 h-7 rounded-full bg-slate-800 hover:bg-blue-600 text-slate-300 hover:text-white flex items-center justify-center text-xs font-bold transition"
                          title="Edit Master Segment"
                        >
                          ✏️
                        </button>
                        <button 
                          onClick={() => {
                            if (!window.confirm("Delete this segment from the library?")) return;
                            const updated = segmentRepo.filter(i => i.id !== item.id);
                            setSegmentRepo(updated);
                            if (user && db) setDoc(doc(db, 'artifacts', appId, 'public', 'segment_repo'), { items: updated });
                            else localStorage.setItem("ros_repo_v6", JSON.stringify(updated));
                          }} 
                          className="w-7 h-7 rounded-full bg-slate-800 hover:bg-rose-600 text-slate-300 hover:text-white flex items-center justify-center text-xs font-bold transition"
                          title="Delete"
                        >
                          ✕
                        </button>
                      </div>
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
                  <div className="flex gap-2">
                    {activeShowId && (
                      <button 
                        onClick={() => { insertFromRepo(item); alert(`Added "${item.title}" to active show!`); }}
                        className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold py-2.5 px-3 rounded-xl transition flex-1 shadow"
                      >
                        + Insert into Active Show
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* EDIT REPO ITEM MODAL WITH SYNC OPTION */}
          {editingRepoItem && (
            <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4 backdrop-blur-sm animate-fade-in">
              <div className={`${isDark ? 'bg-slate-900 border-slate-800 text-white' : 'bg-white border-slate-200 text-slate-900'} border rounded-2xl p-6 w-full max-w-lg shadow-2xl flex flex-col gap-4`}>
                <div className="flex justify-between items-center pb-3 border-b border-slate-800">
                  <h3 className="font-black text-base">Edit Master Segment</h3>
                  <button onClick={() => setEditingRepoItem(null)} className="text-slate-400 hover:text-white font-bold">✕</button>
                </div>
                <p className="text-xs text-slate-400">Updating this master segment allows you to sync changes directly into your active show rundown.</p>
                
                <div className="flex flex-col gap-3">
                  <div>
                    <label className="text-xs font-bold mb-1 block">Title:</label>
                    <input 
                      type="text" 
                      value={editingRepoItem.title} 
                      onChange={(e) => setEditingRepoItem({ ...editingRepoItem, title: e.target.value })}
                      className={`w-full p-2.5 rounded-xl border text-xs ${isDark ? 'bg-slate-950 border-slate-800 text-white' : 'bg-slate-50 border-slate-300'}`}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-bold mb-1 block">Minutes:</label>
                      <input 
                        type="number" 
                        value={editingRepoItem.min} 
                        onChange={(e) => setEditingRepoItem({ ...editingRepoItem, min: parseInt(e.target.value) || 0 })}
                        className={`w-full p-2.5 rounded-xl border text-xs font-mono ${isDark ? 'bg-slate-950 border-slate-800 text-white' : 'bg-slate-50 border-slate-300'}`}
                      />
                    </div>
                    <div>
                      <label className="text-xs font-bold mb-1 block">Seconds:</label>
                      <input 
                        type="number" 
                        value={editingRepoItem.sec} 
                        onChange={(e) => setEditingRepoItem({ ...editingRepoItem, sec: parseInt(e.target.value) || 0 })}
                        className={`w-full p-2.5 rounded-xl border text-xs font-mono ${isDark ? 'bg-slate-950 border-slate-800 text-white' : 'bg-slate-50 border-slate-300'}`}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-bold mb-1 block">Talent / Presenter:</label>
                    <input 
                      type="text" 
                      value={editingRepoItem.talent} 
                      onChange={(e) => setEditingRepoItem({ ...editingRepoItem, talent: e.target.value })}
                      className={`w-full p-2.5 rounded-xl border text-xs ${isDark ? 'bg-slate-950 border-slate-800 text-white' : 'bg-slate-50 border-slate-300'}`}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold mb-1 block">Script & Cue Notes:</label>
                    <textarea 
                      rows="4"
                      value={editingRepoItem.script.replace(/<[^>]*>/g, '')} 
                      onChange={(e) => setEditingRepoItem({ ...editingRepoItem, script: e.target.value })}
                      className={`w-full p-2.5 rounded-xl border text-xs ${isDark ? 'bg-slate-950 border-slate-800 text-white' : 'bg-slate-50 border-slate-300'}`}
                    />
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
                  <button onClick={() => setEditingRepoItem(null)} className="px-4 py-2 rounded-xl text-xs font-bold bg-slate-800 text-slate-300 hover:bg-slate-700">Cancel</button>
                  <button 
                    onClick={() => updateRepoItemMaster(editingRepoItem, false)}
                    className="px-4 py-2 rounded-xl text-xs font-bold bg-slate-700 hover:bg-slate-600 text-white"
                  >
                    Save Master Only
                  </button>
                  <button 
                    onClick={() => updateRepoItemMaster(editingRepoItem, true)}
                    className="px-4 py-2 rounded-xl text-xs font-bold bg-purple-600 hover:bg-purple-700 text-white shadow-lg shadow-purple-600/30"
                  >
                    Save & Sync to Active Show
                  </button>
                </div>
              </div>
            </div>
          )}
        </main>
      )}

      {/* VIEW 3: DEDICATED PRODUCER CONTROL VIEW */}
      {currentView === "producer" && (() => {
        const activeItem = activeTimedRundown[activeProducerIndex];
        const nextTimedItem = activeTimedRundown.slice(activeProducerIndex + 1).find(i => i.type !== "block");
        
        let diffSecs = 0;
        let isOverdue = false;
        if (nextTimedItem && nextTimedItem.rawSeconds) {
          const currentEpochSecs = Math.floor(nowTimestamp / 1000);
          const todayBase = new Date();
          todayBase.setHours(0,0,0,0);
          const todayBaseSecs = Math.floor(todayBase.getTime() / 1000);
          const currentShowSecs = currentEpochSecs - todayBaseSecs;
          
          diffSecs = nextTimedItem.rawSeconds - currentShowSecs;
          if (diffSecs < 0) isOverdue = true;
        }

        const absDiff = Math.abs(diffSecs);
        const cdMins = Math.floor(absDiff / 60);
        const cdSecs = absDiff % 60;
        const countdownStr = `${isOverdue ? '-' : ''}${String(cdMins).padStart(2,'0')}:${String(cdSecs).padStart(2,'0')}`;
        
        const isWarning = !isOverdue && diffSecs <= 10 && diffSecs > 0;
        const isFlashRed = isOverdue;

        return (
          <main className="max-w-6xl mx-auto animate-fade-in">
            <div className={`flex flex-wrap items-center justify-between gap-4 mb-6 bg-slate-900 text-white p-6 rounded-2xl shadow-xl transition-all ${isFlashRed ? 'border-2 border-rose-500 animate-pulse' : isWarning ? 'border-2 border-amber-500 animate-pulse' : 'border border-slate-800'}`}>
              <div>
                <div className="flex items-center gap-3">
                  <span className="text-[10px] uppercase font-bold tracking-wider text-indigo-400 bg-indigo-500/20 px-2.5 py-1 rounded-full border border-indigo-500/30">Live Producer Control Room</span>
                  <label className="flex items-center gap-2 text-xs font-semibold text-slate-300 bg-slate-950 px-3 py-1 rounded-xl border border-slate-800 cursor-pointer">
                    <input 
                      type="checkbox" 
                      checked={syncPrompterWithProducer} 
                      onChange={(e) => setSyncPrompterWithProducer(e.target.checked)}
                      className="accent-blue-600 rounded"
                    />
                    Sync Prompter to Producer
                  </label>
                </div>
                <h2 className="text-2xl font-black mt-2">{showTitle}</h2>
              </div>
              <div className="flex items-center gap-6">
                <div className="text-right">
                  <div className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">Time of Day</div>
                  <div className="font-mono text-xl font-black text-amber-400">{currentTimeStr}</div>
                </div>
                <div className="w-px h-8 bg-slate-800"></div>
                <div className="text-right">
                  <div className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">Countdown to Next</div>
                  <div className={`font-mono text-xl font-black px-3 py-1 rounded-xl transition ${isOverdue ? 'bg-rose-600 text-white animate-bounce' : isWarning ? 'bg-amber-500 text-slate-950 animate-pulse' : 'text-emerald-400 bg-emerald-500/10'}`}>
                    {nextTimedItem ? countdownStr : "--:--"}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button 
                    onClick={() => { setActiveProducerIndex(0); setCurrentView("prompter"); }}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2.5 rounded-xl text-xs font-bold transition shadow"
                  >
                    Prompter 📺
                  </button>
                  <button 
                    onClick={() => setCurrentView("editor")}
                    className="bg-slate-700 hover:bg-slate-600 text-white px-4 py-2.5 rounded-xl text-xs font-bold transition shadow"
                  >
                    Exit ✕
                  </button>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Active Cue Spotlight Card with All Column Notes */}
              <div className="md:col-span-1 bg-slate-900 border border-slate-800 p-6 rounded-2xl shadow-xl flex flex-col justify-between">
                <div>
                  <div className="text-xs uppercase font-bold text-slate-400 mb-2">Current Active Cue</div>
                  {activeItem ? (
                    <div className="space-y-3">
                      <div className="text-sm font-mono text-emerald-400 font-bold">[{activeItem.calculatedTime || "BLOCK"}]</div>
                      <h3 className="text-xl font-black text-white">{activeItem.title || "Untitled"}</h3>
                      {activeItem.talent && (
                        <p className="text-xs text-amber-400 font-semibold">🎙️ {activeItem.talent}</p>
                      )}
                      
                      {/* Script / Notes */}
                      <div 
                        className="text-xs text-slate-300 bg-slate-950 p-3 rounded-xl border border-slate-800 max-h-32 overflow-y-auto"
                        dangerouslySetInnerHTML={{ __html: activeItem.script || activeItem.type.toUpperCase() }}
                      />

                      {/* Display All Custom Columns on Producer View */}
                      {customColumns.length > 0 && activeItem.customValues && (
                        <div className="space-y-1.5 pt-2 border-t border-slate-800">
                          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Production Column Notes:</div>
                          {customColumns.map((colName, cIdx) => {
                            const val = activeItem.customValues[cIdx];
                            if (!val) return null;
                            return (
                              <div key={cIdx} className="text-xs bg-slate-950/60 p-2 rounded-lg border border-slate-800 flex justify-between gap-2">
                                <span className="font-bold text-indigo-400">{colName}:</span>
                                <span className="text-slate-300 text-right">{val}</span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="text-xs text-slate-400">No cue selected.</p>
                  )}
                </div>
                <div className="flex gap-2 pt-6 border-t border-slate-800 mt-6">
                  <button 
                    onClick={() => setActiveProducerIndex(Math.max(0, activeProducerIndex - 1))}
                    className="flex-1 bg-indigo-800 hover:bg-indigo-700 py-3 rounded-xl text-xs font-bold transition"
                  >
                    ◀ Previous Cue
                  </button>
                  <button 
                    onClick={() => setActiveProducerIndex(Math.min(activeTimedRundown.length - 1, activeProducerIndex + 1))}
                    className="flex-1 bg-violet-600 hover:bg-violet-700 py-3 rounded-xl text-xs font-bold transition shadow-lg shadow-violet-600/30"
                  >
                    Next Cue ▶
                  </button>
                </div>
              </div>

              {/* Rundown Quick Jump List with Color-Coded Blocks and Cues */}
              <div className="md:col-span-2 bg-slate-900 border border-slate-800 p-6 rounded-2xl shadow-xl flex flex-col">
                <h3 className="font-black text-xs uppercase tracking-wider text-slate-400 mb-4">Rundown Sequence Tracker</h3>
                <div className="flex-1 overflow-y-auto space-y-2 max-h-[500px] pr-2">
                  {activeTimedRundown.map((item, idx) => {
                    const isBlock = item.type === "block";
                    const isCue = item.type === "cue";
                    const rowStyle = isBlock || isCue ? { backgroundColor: item.color || (isBlock ? '#3b82f6' : '#f59e0b') } : {};

                    return (
                      <div 
                        key={item.id || idx}
                        onClick={() => setActiveProducerIndex(idx)}
                        style={rowStyle}
                        className={`p-3.5 rounded-xl border text-xs cursor-pointer transition flex items-center justify-between ${isBlock || isCue ? 'text-white font-bold' : ''} ${activeProducerIndex === idx ? 'ring-4 ring-indigo-400 shadow-xl' : isBlock || isCue ? 'border-white/20' : 'bg-slate-950/60 border-slate-800 text-slate-300 hover:border-slate-700'}`}
                      >
                        <div className="flex items-center gap-3">
                          <span className={`font-mono font-bold ${isBlock || isCue ? 'text-white' : 'text-emerald-400'}`}>{item.calculatedTime || "---"}</span>
                          <div>
                            <div className="font-bold">{item.title || (isBlock ? "SECTION BLOCK" : "Untitled")}</div>
                            <div className={`text-[10px] ${isBlock || isCue ? 'text-white/80' : 'text-slate-400'}`}>{item.talent ? `Talent: ${item.talent}` : item.type.toUpperCase()}</div>
                          </div>
                        </div>
                        {activeProducerIndex === idx && (
                          <span className="bg-white text-slate-950 text-[10px] font-black px-2.5 py-0.5 rounded-full shadow">ACTIVE</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </main>
        );
      })()}

      {/* VIEW 4: FULLSCREEN TELEPROMPTER WITH COUNTDOWN TIMER */}
      {currentView === "prompter" && (() => {
        const nextTimedItem = activeTimedRundown.slice(activeProducerIndex + 1).find(i => i.type !== "block");
        let diffSecs = 0;
        let isOverdue = false;
        if (nextTimedItem && nextTimedItem.rawSeconds) {
          const currentEpochSecs = Math.floor(nowTimestamp / 1000);
          const todayBase = new Date();
          todayBase.setHours(0,0,0,0);
          const currentShowSecs = currentEpochSecs - Math.floor(todayBase.getTime() / 1000);
          diffSecs = nextTimedItem.rawSeconds - currentShowSecs;
          if (diffSecs < 0) isOverdue = true;
        }
        const absDiff = Math.abs(diffSecs);
        const countdownStr = `${isOverdue ? '-' : ''}${String(Math.floor(absDiff/60)).padStart(2,'0')}:${String(absDiff%60).padStart(2,'0')}`;

        return (
          <div className="fixed inset-0 bg-black z-50 flex flex-col text-white animate-fade-in w-screen h-screen">
            {/* Sticky Teleprompter Control Room Header */}
            <header className="bg-slate-900/95 border-b border-slate-800 px-6 py-3 flex flex-wrap items-center justify-between gap-4 z-50 backdrop-blur shadow-xl w-full">
              <div className="flex items-center gap-4">
                <span className="text-xs px-3 py-1 rounded-full bg-emerald-600 font-bold flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-white animate-pulse"></span>
                  LIVE TELEPROMPTER
                </span>
                <div className="hidden md:flex items-center gap-4 text-xs font-mono bg-slate-950 px-3 py-1.5 rounded-xl border border-slate-800">
                  <span>TIME: <strong className="text-amber-400">{currentTimeStr}</strong></span>
                  <span>COUNTDOWN: <strong className={isOverdue ? 'text-rose-500 animate-pulse' : 'text-emerald-400'}>{nextTimedItem ? countdownStr : "--:--"}</strong></span>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <button 
                  onClick={() => setIsPrompterPlaying(!isPrompterPlaying)}
                  className={`px-4 py-2 rounded-xl text-xs font-bold transition shadow ${isPrompterPlaying ? 'bg-amber-600 hover:bg-amber-700' : 'bg-blue-600 hover:bg-blue-700'}`}
                >
                  {isPrompterPlaying ? "⏸ Pause Auto-Scroll" : "▶ Play Auto-Scroll"}
                </button>

                <label className="text-xs flex items-center gap-2 bg-slate-950 px-3 py-1.5 rounded-xl border border-slate-800">
                  Speed:
                  <input 
                    type="range" 
                    min="1" 
                    max="10" 
                    value={prompterSpeed} 
                    onChange={(e) => setPrompterSpeed(parseInt(e.target.value))}
                    className="cursor-pointer accent-blue-500 w-20"
                  />
                </label>

                <div className="flex items-center gap-1 bg-slate-950 px-3 py-1.5 rounded-xl border border-slate-800 text-xs">
                  <span>Text Size:</span>
                  <button onClick={() => setPrompterFontSize(Math.max(24, prompterFontSize - 4))} className="px-2 py-0.5 bg-slate-800 hover:bg-slate-700 rounded font-bold">A-</button>
                  <span className="font-mono w-6 text-center">{prompterFontSize}</span>
                  <button onClick={() => setPrompterFontSize(Math.min(72, prompterFontSize + 4))} className="px-2 py-0.5 bg-slate-800 hover:bg-slate-700 rounded font-bold">A+</button>
                </div>

                <button 
                  onClick={() => setCurrentView("editor")}
                  className="bg-rose-600 hover:bg-rose-700 text-white px-3.5 py-2 rounded-xl text-xs font-bold transition shadow"
                >
                  Exit Prompter
                </button>
              </div>
            </header>

            {/* Prompter Body Feed with global enforced font size normalization */}
            <div ref={prompterRef} className="flex-1 overflow-y-auto px-6 md:px-20 py-16 leading-relaxed w-full" style={{ fontSize: `${prompterFontSize}px` }}>
              <style>{`
                .prompter-script-body * {
                  font-size: inherit !important;
                  line-height: inherit !important;
                  font-family: inherit !important;
                }
              `}</style>
              <div className="max-w-5xl mx-auto w-full">
                <h1 className="font-black text-sky-400 mb-12 pb-6 border-b border-slate-800 tracking-tight" style={{ fontSize: `${prompterFontSize * 1.3}px` }}>{showTitle}</h1>
                {activeTimedRundown.map((item, idx) => {
                  const isActive = activeProducerIndex === idx;
                  if (item.type === "block") {
                    return (
                      <div 
                        key={item.id || idx}
                        ref={el => { prompterItemRefs.current[idx] = el; }}
                        style={{ backgroundColor: item.color, fontSize: `${prompterFontSize * 1.1}px` }} 
                        className={`p-6 my-10 font-bold uppercase rounded-2xl shadow-2xl text-white tracking-wide transition-all ${isActive ? 'ring-4 ring-amber-400 scale-[1.02]' : ''}`}
                      >
                        {item.title || "SECTION"}
                      </div>
                    );
                  }
                  if (item.type === "cue") {
                    return (
                      <div 
                        key={item.id || idx}
                        ref={el => { prompterItemRefs.current[idx] = el; }}
                        style={{ backgroundColor: item.color, color: item.color === "#f59e0b" ? "#0f172a" : "#fff" }} 
                        className={`p-5 my-8 font-bold rounded-2xl shadow-xl transition-all ${isActive ? 'ring-4 ring-amber-400 scale-[1.02]' : ''}`}
                      >
                        [CUE {item.calculatedTime}] {item.title || 'Cue'} {item.talent ? `| Target: ${item.talent}` : ''}
                      </div>
                    );
                  }
                  if (item.type === "segment" && item.script && item.script.replace(/<[^>]*>/g, '').trim() !== "") {
                    return (
                      <div 
                        key={item.id || idx} 
                        ref={el => { prompterItemRefs.current[idx] = el; }}
                        className={`mb-20 pb-10 border-b border-slate-800 transition-all p-4 rounded-2xl ${isActive ? 'bg-slate-900/80 border-amber-400/50 ring-2 ring-amber-400/40' : ''}`}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <span className={`font-mono font-bold ${isActive ? 'text-amber-400' : 'text-sky-400'}`} style={{ fontSize: `${prompterFontSize * 1.1}px` }}>
                            {isActive ? '▶ ' : ''}[{item.calculatedTime}] {item.title || 'Segment'}
                          </span>
                          <span className="font-mono text-slate-400" style={{ fontSize: `${prompterFontSize * 0.8}px` }}>Dur: {item.min}m {item.sec}s</span>
                        </div>
                        {item.talent && <div className="text-amber-400 font-semibold mb-4" style={{ fontSize: `${prompterFontSize * 0.95}px` }}>🎙️ {item.talent}</div>}
                        <div 
                          className="text-slate-100 font-medium prompter-script-body"
                          style={{ textTransform: item.isUpper ? 'uppercase' : 'none', lineHeight: '1.6' }}
                          dangerouslySetInnerHTML={{ __html: sanitizeScriptHtml(item.script) }} 
                        />
                      </div>
                    );
                  }
                  return null;
                })}
              </div>
            </div>
          </div>
        );
      })()}

      {/* VIEW 5: MODERN ACTIVE SHOW EDITOR */}
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
            <button onClick={() => { setActiveProducerIndex(0); setCurrentView("producer"); }} className="bg-indigo-500 hover:bg-indigo-600 text-white font-bold px-3.5 py-2 rounded-xl text-xs shadow transition flex items-center gap-1.5">⏱️ Producer</button>
            <button onClick={() => { setActiveProducerIndex(0); setCurrentView("prompter"); }} className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-3.5 py-2 rounded-xl text-xs shadow transition flex items-center gap-1.5">📺 Prompter</button>
            <button onClick={exportShowJson} className="bg-purple-600 hover:bg-purple-700 text-white font-bold px-3.5 py-2 rounded-xl text-xs shadow transition">📥 Export JSON</button>
            <label className="bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold px-3.5 py-2 rounded-xl text-xs shadow transition cursor-pointer">
              📤 Import JSON
              <input type="file" accept=".json" onChange={importShowJson} className="hidden" />
            </label>
            <button onClick={() => window.print()} className="bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold px-3.5 py-2 rounded-xl text-xs shadow transition">📄 Print PDF</button>
          </div>

          {/* Rundown Interactive Table */}
          <div className={`overflow-x-auto shadow-2xl rounded-2xl border ${isDark ? 'border-slate-800 bg-slate-900' : 'border-slate-200 bg-white'}`}>
            <table className="w-full border-collapse min-w-[1050px]">
              <thead>
                <tr className="bg-slate-900 text-white text-left text-[11px] uppercase tracking-wider">
                  <th className="p-3.5 w-[50px] text-center">⋮⋮</th>
                  <th className="p-3.5 w-[140px]">Time</th>
                  <th className="p-3.5 w-[130px]">Duration</th>
                  <th className="p-3.5 w-[180px]">Segment / Title</th>
                  <th className="p-3.5 w-[140px]">Talent</th>
                  <th className="p-3.5 w-[340px]">Script & Cue Notes</th>
                  {customColumns.map((col, idx) => (
                    <th key={idx} className="p-3.5 w-[180px]">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate">{col}</span>
                        <button 
                          onClick={() => removeColumn(idx)} 
                          className="w-5 h-5 rounded-full bg-rose-500/20 hover:bg-rose-600 text-rose-300 hover:text-white flex items-center justify-center text-[10px] font-bold transition flex-shrink-0"
                          title="Delete Column"
                        >
                          ✕
                        </button>
                      </div>
                    </th>
                  ))}
                  <th className="p-3.5 w-[110px] text-center">Actions</th>
                </tr>
              </thead>
              <tbody className={`divide-y ${isDark ? 'divide-slate-800/80' : 'divide-slate-200'}`}>
                {activeTimedRundown.map((item, index) => {
                  
                  // BLOCK HEADER ROW
                  if (item.type === "block") {
                    const colSpanCount = 7 + customColumns.length;
                    return (
                      <tr 
                        key={item.id || index} 
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
                            {/* Modern Color Preset Buttons */}
                            <div className="flex items-center gap-1 bg-black/30 p-1 rounded-xl">
                              {["#3b82f6", "#10b981", "#8b5cf6", "#f59e0b", "#ef4444", "#475569"].map(c => (
                                <button
                                  key={c}
                                  onClick={() => updateItem(index, 'color', c)}
                                  style={{ backgroundColor: c }}
                                  className={`w-5 h-5 rounded-lg border transition ${item.color === c ? 'border-white scale-110 ring-2 ring-white/50' : 'border-transparent opacity-70 hover:opacity-100'}`}
                                  title={`Color ${c}`}
                                />
                              ))}
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
                          <div className="flex items-center justify-center gap-1.5">
                            <button onClick={() => moveRow(index, -1)} className="w-7 h-7 rounded-xl bg-black/30 hover:bg-black/50 text-white text-xs flex items-center justify-center transition" title="Move Up">▲</button>
                            <button onClick={() => moveRow(index, 1)} className="w-7 h-7 rounded-xl bg-black/30 hover:bg-black/50 text-white text-xs flex items-center justify-center transition" title="Move Down">▼</button>
                            <button 
                              onClick={() => deleteRow(index)} 
                              className="w-7 h-7 rounded-full bg-rose-600/80 hover:bg-rose-600 text-white text-xs flex items-center justify-center font-bold transition shadow"
                              title="Delete Row"
                            >
                              ✕
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  }

                  // CUE ROW
                  if (item.type === "cue") {
                    return (
                      <tr 
                        key={item.id || index} 
                        draggable 
                        onDragStart={(e) => handleDragStart(e, index)}
                        onDragOver={(e) => handleDragOver(e, index)}
                        onDrop={(e) => handleDrop(e, index)}
                        style={{ backgroundColor: item.color }} 
                        className="transition-all hover:brightness-95 cursor-grab active:cursor-grabbing"
                      >
                        <td className="p-3.5 text-center text-slate-700 font-bold">⋮⋮</td>
                        <td className="p-3.5 font-mono font-bold text-xs text-slate-900">{item.calculatedTime}</td>
                        <td className="p-3.5 relative">
                          <div 
                            onClick={() => setOpenDurationPopup(openDurationPopup === item.id ? null : item.id)}
                            className="bg-white/70 hover:bg-white px-3 py-1.5 rounded-xl border border-black/10 shadow-sm font-mono text-xs font-bold text-slate-900 cursor-pointer text-center select-none"
                          >
                            {item.min}m {item.sec}s ⏱️
                          </div>
                          {openDurationPopup === item.id && (
                            <div className="absolute z-50 top-12 left-0 bg-slate-900 text-white p-4 rounded-2xl shadow-2xl border border-slate-700 w-48 flex flex-col gap-3">
                              <div className="text-[10px] uppercase font-bold text-slate-400">Edit Duration</div>
                              <div className="flex items-center gap-2">
                                <label className="text-xs">Min:</label>
                                <input 
                                  type="number" 
                                  value={item.min} 
                                  min="0" 
                                  onChange={(e) => updateItem(index, 'min', Math.max(0, parseInt(e.target.value) || 0))} 
                                  className="w-16 bg-slate-800 text-white border border-slate-700 rounded-lg p-1 text-xs text-center font-mono" 
                                />
                              </div>
                              <div className="flex items-center gap-2">
                                <label className="text-xs">Sec:</label>
                                <input 
                                  type="number" 
                                  value={item.sec} 
                                  min="0" 
                                  max="59" 
                                  onChange={(e) => updateItem(index, 'sec', Math.min(59, Math.max(0, parseInt(e.target.value) || 0)))} 
                                  className="w-16 bg-slate-800 text-white border border-slate-700 rounded-lg p-1 text-xs text-center font-mono" 
                                />
                              </div>
                              <button 
                                onClick={() => setOpenDurationPopup(null)}
                                className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold py-1.5 rounded-xl"
                              >
                                Done
                              </button>
                            </div>
                          )}
                        </td>
                        <td className="p-3.5">
                          <AutoTextarea
                            value={item.title} 
                            onChange={(e) => updateItem(index, 'title', e.target.value)} 
                            className="w-full p-2.5 border rounded-xl bg-white text-slate-900 text-xs font-semibold shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500" 
                            placeholder="Cue Title..." 
                          />
                        </td>
                        <td className="p-3.5">
                          <AutoTextarea
                            value={item.talent} 
                            onChange={(e) => updateItem(index, 'talent', e.target.value)} 
                            className="w-full p-2.5 border rounded-xl bg-white text-slate-900 text-xs shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500" 
                            placeholder="Target / AV..." 
                          />
                        </td>
                        <td className="p-3.5">
                          <div className="flex items-center gap-3">
                            <span className="font-bold text-[10px] uppercase text-slate-900">Tone:</span>
                            <div className="flex gap-1.5">
                              {["#f59e0b", "#10b981", "#3b82f6", "#ef4444", "#8b5cf6"].map(c => (
                                <button 
                                  key={c}
                                  onClick={() => updateItem(index, 'color', c)}
                                  style={{ backgroundColor: c }}
                                  className={`w-5 h-5 rounded-lg border shadow transition ${item.color === c ? 'border-slate-900 scale-110' : 'border-white/50'}`}
                                />
                              ))}
                            </div>
                          </div>
                        </td>
                        {customColumns.map((_, colIdx) => (
                          <td key={colIdx} className="p-3.5">
                            <AutoTextarea
                              value={item.customValues?.[colIdx] || ""} 
                              onChange={(e) => updateCustomVal(index, colIdx, e.target.value)} 
                              className="w-full p-2.5 border rounded-xl bg-white text-slate-900 text-xs shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500" 
                              placeholder="Notes..." 
                            />
                          </td>
                        ))}
                        <td className="p-3.5 text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            <button onClick={() => moveRow(index, -1)} className="w-7 h-7 rounded-xl bg-slate-700 text-white text-xs flex items-center justify-center transition" title="Move Up">▲</button>
                            <button onClick={() => moveRow(index, 1)} className="w-7 h-7 rounded-xl bg-slate-700 text-white text-xs flex items-center justify-center transition" title="Move Down">▼</button>
                            <button 
                              onClick={() => deleteRow(index)} 
                              className="w-7 h-7 rounded-full bg-rose-600 hover:bg-rose-700 text-white text-xs flex items-center justify-center font-bold transition shadow"
                              title="Delete Row"
                            >
                              ✕
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  }

                  // STANDARD SEGMENT ROW
                  return (
                    <tr 
                      key={item.id || index} 
                      draggable 
                      onDragStart={(e) => handleDragStart(e, index)}
                      onDragOver={(e) => handleDragOver(e, index)}
                      onDrop={(e) => handleDrop(e, index)}
                      className={`${isDark ? 'hover:bg-slate-800/50' : 'hover:bg-slate-50'} transition-colors cursor-grab active:cursor-grabbing`}
                    >
                      <td className={`p-3.5 text-center font-bold ${isDark ? 'text-slate-600' : 'text-slate-400'}`}>⋮⋮</td>
                      <td className="p-3.5">
                        <div className="flex flex-col gap-1.5">
                          {item.isLockedTime ? (
                            <div className="flex items-center gap-1">
                              <input 
                                type="text"
                                value={item.lockedTimeStr || item.calculatedTime}
                                onChange={(e) => {
                                  const updated = [...rundown];
                                  updated[index].lockedTimeStr = e.target.value;
                                  setRundown(updated);
                                  persistShow(showTitle, startTime, customColumns, updated);
                                }}
                                className={`font-mono font-bold text-xs p-1 rounded-lg border w-24 ${isDark ? 'bg-slate-800 border-slate-700 text-amber-400' : 'bg-white border-slate-300 text-amber-600'}`}
                              />
                            </div>
                          ) : (
                            <span className={`font-mono font-bold text-xs ${isDark ? 'text-emerald-400' : 'text-emerald-600'}`}>{item.calculatedTime}</span>
                          )}
                          <button 
                            onClick={() => {
                              const newLock = !item.isLockedTime;
                              const updated = [...rundown];
                              updated[index].isLockedTime = newLock;
                              if (newLock) updated[index].lockedTimeStr = item.calculatedTime;
                              setRundown(updated);
                              persistShow(showTitle, startTime, customColumns, updated);
                            }}
                            className={`text-[9px] font-bold px-2 py-0.5 rounded-lg transition w-max ${item.isLockedTime ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' : 'bg-slate-800/20 text-slate-400 hover:text-slate-200'}`}
                          >
                            {item.isLockedTime ? '🔒 Hard Start' : '🔓 Auto Time'}
                          </button>
                        </div>
                      </td>
                      <td className="p-3.5 relative">
                        <div 
                          onClick={() => setOpenDurationPopup(openDurationPopup === item.id ? null : item.id)}
                          className={`px-3 py-1.5 rounded-xl border shadow-sm font-mono text-xs font-bold cursor-pointer text-center select-none ${isDark ? 'bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700' : 'bg-white border-slate-200 text-slate-800 hover:bg-slate-50'}`}
                        >
                          {item.min}m {item.sec}s ⏱️
                        </div>
                        {openDurationPopup === item.id && (
                          <div className="absolute z-50 top-12 left-0 bg-slate-900 text-white p-4 rounded-2xl shadow-2xl border border-slate-700 w-48 flex flex-col gap-3">
                            <div className="text-[10px] uppercase font-bold text-slate-400">Edit Duration</div>
                            <div className="flex items-center gap-2">
                              <label className="text-xs">Min:</label>
                              <input 
                                type="number" 
                                value={item.min} 
                                min="0" 
                                onChange={(e) => updateItem(index, 'min', Math.max(0, parseInt(e.target.value) || 0))} 
                                className="w-16 bg-slate-800 text-white border border-slate-700 rounded-lg p-1 text-xs text-center font-mono" 
                              />
                            </div>
                            <div className="flex items-center gap-2">
                              <label className="text-xs">Sec:</label>
                              <input 
                                type="number" 
                                value={item.sec} 
                                min="0" 
                                max="59" 
                                onChange={(e) => updateItem(index, 'sec', Math.min(59, Math.max(0, parseInt(e.target.value) || 0)))} 
                                className="w-16 bg-slate-800 text-white border border-slate-700 rounded-lg p-1 text-xs text-center font-mono" 
                              />
                            </div>
                            <button 
                              onClick={() => setOpenDurationPopup(null)}
                              className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold py-1.5 rounded-xl"
                            >
                              Done
                            </button>
                          </div>
                        )}
                      </td>
                      <td className="p-3.5">
                        <AutoTextarea
                          value={item.title} 
                          onChange={(e) => updateItem(index, 'title', e.target.value)} 
                          className={`w-full p-2.5 border rounded-xl text-xs font-semibold shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-600 ${isDark ? 'bg-slate-800 border-slate-700 text-white' : 'bg-white border-slate-300 text-slate-900'}`} 
                          placeholder="Segment Title..." 
                        />
                      </td>
                      <td className="p-3.5">
                        <AutoTextarea
                          value={item.talent} 
                          onChange={(e) => updateItem(index, 'talent', e.target.value)} 
                          className={`w-full p-2.5 border rounded-xl text-xs shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-600 ${isDark ? 'bg-slate-800 border-slate-700 text-white' : 'bg-white border-slate-300 text-slate-900'}`} 
                          placeholder="Talent Name..." 
                        />
                      </td>
                      <td className="p-3.5">
                        <div className="flex items-center justify-between gap-1 mb-2">
                          <div className="flex gap-1.5">
                            <button onClick={() => document.execCommand('bold')} className="bg-slate-800 hover:bg-slate-700 text-white px-2.5 py-1 text-[11px] rounded-lg font-bold shadow">B</button>
                            <button onClick={() => document.execCommand('italic')} className="bg-slate-800 hover:bg-slate-700 text-white px-2.5 py-1 text-[11px] rounded-lg italic shadow">I</button>
                            <button onClick={() => updateItem(index, 'isUpper', !item.isUpper)} className={`px-2.5 py-1 text-[11px] rounded-lg font-semibold shadow ${item.isUpper ? 'bg-blue-600 text-white' : 'bg-slate-800 text-white'}`}>CAPS</button>
                          </div>
                          <button onClick={() => saveToRepo(item)} className="bg-purple-500/10 hover:bg-purple-500/20 text-purple-400 border border-purple-500/20 text-[10px] font-bold px-2.5 py-1 rounded-xl transition">💾 Save to Repo</button>
                        </div>
                        <div 
                          contentEditable={true} 
                          suppressContentEditableWarning={true}
                          onBlur={(e) => updateItem(index, 'script', e.target.innerHTML)}
                          dangerouslySetInnerHTML={{ __html: item.script }}
                          style={{ textTransform: item.isUpper ? 'uppercase' : 'none' }}
                          className={`min-h-[80px] p-3 border rounded-xl text-xs outline-none focus:border-blue-600 overflow-y-auto shadow-inner ${isDark ? 'bg-slate-800/80 border-slate-700 text-slate-200' : 'bg-white border-slate-300 text-slate-900'}`}
                        />
                      </td>
                      {customColumns.map((_, colIdx) => (
                        <td key={colIdx} className="p-3.5">
                          <AutoTextarea
                            value={item.customValues?.[colIdx] || ""} 
                            onChange={(e) => updateCustomVal(index, colIdx, e.target.value)} 
                            className={`w-full p-2.5 border rounded-xl text-xs shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-600 ${isDark ? 'bg-slate-800 border-slate-700 text-white' : 'bg-white border-slate-300 text-slate-900'}`} 
                            placeholder="Notes..." 
                          />
                        </td>
                      ))}
                      <td className="p-3.5 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          <button onClick={() => moveRow(index, -1)} className="w-7 h-7 rounded-xl bg-slate-700 hover:bg-slate-600 text-white text-xs flex items-center justify-center transition" title="Move Up">▲</button>
                          <button onClick={() => moveRow(index, 1)} className="w-7 h-7 rounded-xl bg-slate-700 hover:bg-slate-600 text-white text-xs flex items-center justify-center transition" title="Move Down">▼</button>
                          <button 
                            onClick={() => deleteRow(index)} 
                            className="w-7 h-7 rounded-full bg-rose-600 hover:bg-rose-700 text-white text-xs flex items-center justify-center font-bold transition shadow"
                            title="Delete Row"
                          >
                            ✕
                          </button>
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
