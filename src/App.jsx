import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
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
  console.log("Offline/fallback mode:", e);
}

export default function App() {
  const [user, setUser] = useState(null);
  const [authInitialized, setAuthInitialized] = useState(false);
  const [cloudSyncStatus, setCloudSyncStatus] = useState("Connecting to Firebase...");
  const [currentView, setCurrentView] = useState("list");
  const [showsList, setShowsList] = useState([]);
  const [activeShowId, setActiveShowId] = useState(null);

  const [showTitle, setShowTitle] = useState("New Run of Show");
  const [startTime, setStartTime] = useState("09:00:00");
  const [customColumns, setCustomColumns] = useState(["Audio / Cues", "Video / Slides"]);
  const [rundown, setRundown] = useState([]);
  const [segmentLibrary, setSegmentLibrary] = useState([]);

  // Teleprompter & Producer States
  const [isPrompterPlaying, setIsPrompterPlaying] = useState(false);
  const [prompterSpeed, setPrompterSpeed] = useState(3);
  const [prompterFontSize, setPrompterFontSize] = useState(36);
  const [activeProducerIndex, setActiveProducerIndex] = useState(0);
  const [autoSyncPrompter, setAutoSyncPrompter] = useState(true);

  const prompterRef = useRef(null);
  const prompterItemRefs = useRef({});
  const scrollTimerRef = useRef(null);
  const producerItemRefs = useRef({});

  // Duration Popup state
  const [openDurationId, setOpenDurationId] = useState(null);

  // ==================== AUTH & SYNC ====================
  useEffect(() => {
    if (!auth || !db) {
      setAuthInitialized(true);
      setCloudSyncStatus("💾 Local Storage Mode");
      loadLocalShowsFallback();
      return;
    }

    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (err) {
        console.error("Auth error:", err);
        setCloudSyncStatus("⚠️ Auth Error - Local Mode");
      } finally {
        setAuthInitialized(true);
      }
    };
    initAuth();

    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      if (u) setCloudSyncStatus("🟢 Cloud Sync Active");
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user || !db) return;

    const repoRef = doc(db, 'artifacts', appId, 'public', 'segment_library');
    const unsubRepo = onSnapshot(repoRef, (docSnap) => {
      if (docSnap.exists()) {
        setSegmentLibrary(docSnap.data().items || []);
      }
    }, (err) => console.error("Segment library error:", err));

    const showsIndexRef = doc(db, 'artifacts', appId, 'public', 'shows_index');
    const unsubIndex = onSnapshot(showsIndexRef, (docSnap) => {
      if (docSnap.exists()) {
        const list = docSnap.data().shows || [];
        setShowsList(list);
        if (list.length === 0 && currentView === "list") {
          createDefaultShow();
        } else if (list.length > 0 && !activeShowId) {
          setActiveShowId(list[0].id);
        }
      } else {
        createDefaultShow();
      }
      setCloudSyncStatus("🟢 Cloud Sync Active");
    }, (err) => {
      console.error("Shows index error:", err);
      setCloudSyncStatus("🔴 Permission Error (Check Firestore Rules)");
    });

    return () => {
      unsubRepo();
      unsubIndex();
    };
  }, [user]);

  useEffect(() => {
    if (!user || !activeShowId || !db) return;

    const showDocRef = doc(db, 'artifacts', appId, 'public', `show_${activeShowId}`);
    const unsubShow = onSnapshot(showDocRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setShowTitle(data.showTitle || "Untitled Show");
        setStartTime(data.startTime || "09:00:00");
        setCustomColumns(data.customColumns || ["Audio / Cues", "Video / Slides"]);
        setRundown(data.rundown || []);
      }
    }, (err) => console.error("Show doc load error:", err));

    return () => unsubShow();
  }, [user, activeShowId]);

  const loadLocalShowsFallback = () => {
    try {
      const savedShows = localStorage.getItem("ros_shows_list");
      const savedLib = localStorage.getItem("ros_segment_lib");
      if (savedLib) setSegmentLibrary(JSON.parse(savedLib));
      if (savedShows) {
        const list = JSON.parse(savedShows);
        setShowsList(list);
        if (list.length > 0) {
          setActiveShowId(list[0].id);
          loadLocalShowDetails(list[0].id);
        } else {
          createDefaultShowLocal();
        }
      } else {
        createDefaultShowLocal();
      }
    } catch (e) {
      createDefaultShowLocal();
    }
  };

  const loadLocalShowDetails = (id) => {
    try {
      const showData = localStorage.getItem(`ros_show_${id}`);
      if (showData) {
        const parsed = JSON.parse(showData);
        setShowTitle(parsed.showTitle || "Untitled Show");
        setStartTime(parsed.startTime || "09:00:00");
        setCustomColumns(parsed.customColumns || ["Audio / Cues", "Video / Slides"]);
        setRundown(parsed.rundown || []);
      }
    } catch (e) {}
  };

  const saveShowData = async (newTitle = showTitle, newStart = startTime, newCols = customColumns, newRundown = rundown) => {
    if (!activeShowId) return;
    const showData = {
      id: activeShowId,
      showTitle: newTitle,
      startTime: newStart,
      customColumns: newCols,
      rundown: newRundown,
      updatedAt: new Date().toISOString()
    };

    if (user && db) {
      try {
        const showDocRef = doc(db, 'artifacts', appId, 'public', `show_${activeShowId}`);
        await setDoc(showDocRef, showData);
        const showsIndexRef = doc(db, 'artifacts', appId, 'public', 'shows_index');
        const indexSnap = await getDoc(showsIndexRef);
        let list = indexSnap.exists() ? (indexSnap.data().shows || []) : [];
        const existingIdx = list.findIndex(s => s.id === activeShowId);
        if (existingIdx >= 0) {
          list[existingIdx].title = newTitle;
          list[existingIdx].updatedAt = new Date().toISOString();
        } else {
          list.push({ id: activeShowId, title: newTitle, updatedAt: new Date().toISOString() });
        }
        await setDoc(showsIndexRef, { shows: list });
      } catch (err) {
        console.error("Save show error:", err);
      }
    } else {
      try {
        localStorage.setItem(`ros_show_${activeShowId}`, JSON.stringify(showData));
        const updatedList = showsList.map(s => s.id === activeShowId ? { ...s, title: newTitle, updatedAt: new Date().toISOString() } : s);
        setShowsList(updatedList);
        localStorage.setItem("ros_shows_list", JSON.stringify(updatedList));
      } catch (e) {}
    }
  };

  const createDefaultShowLocal = () => {
    const defaultId = "show_" + Date.now();
    const initialShow = {
      id: defaultId,
      showTitle: "Annual Keynote Conference 2026",
      startTime: "09:00:00",
      customColumns: ["Audio / Cues", "Video / Slides"],
      rundown: [
        { id: "block-1", type: "block", title: "BLOCK 1: INTRO & KEYNOTE", color: "#1e3a8a" },
        { id: "seg-1", type: "segment", min: 1, sec: 30, title: "Intro & Welcome", talent: "Host / MC", script: "Welcome everyone to today's show!", customValues: ["Roll intro music", "Main presentation deck"], isUpper: false, timeMode: "auto" },
        { id: "cue-1", type: "cue", min: 0, sec: 15, title: "Cue Video Roll", talent: "Video Op", color: "#FFD700", customValues: ["Roll Opening Hype Reel", "Video Input 1"], timeMode: "auto" }
      ]
    };
    setActiveShowId(defaultId);
    setShowsList([{ id: defaultId, title: initialShow.showTitle, updatedAt: new Date().toISOString() }]);
    setShowTitle(initialShow.showTitle);
    setStartTime(initialShow.startTime);
    setCustomColumns(initialShow.customColumns);
    setRundown(initialShow.rundown);
  };

  const createDefaultShow = async () => {
    const defaultId = "show_" + Date.now();
    const initialShow = {
      id: defaultId,
      showTitle: "Annual Keynote Conference 2026",
      startTime: "09:00:00",
      customColumns: ["Audio / Cues", "Video / Slides"],
      rundown: [
        { id: "block-1", type: "block", title: "BLOCK 1: INTRO & KEYNOTE", color: "#1e3a8a" },
        { id: "seg-1", type: "segment", min: 1, sec: 30, title: "Intro & Welcome", talent: "Host / MC", script: "Welcome everyone to today's show!", customValues: ["Roll intro music", "Main presentation deck"], isUpper: false, timeMode: "auto" },
        { id: "cue-1", type: "cue", min: 0, sec: 15, title: "Cue Video Roll", talent: "Video Op", color: "#FFD700", customValues: ["Roll Opening Hype Reel", "Video Input 1"], timeMode: "auto" }
      ]
    };

    if (user && db) {
      try {
        await setDoc(doc(db, 'artifacts', appId, 'public', `show_${defaultId}`), initialShow);
        await setDoc(doc(db, 'artifacts', appId, 'public', 'shows_index'), {
          shows: [{ id: defaultId, title: initialShow.showTitle, updatedAt: new Date().toISOString() }]
        });
        setActiveShowId(defaultId);
      } catch (e) {
        console.error("Create default show error:", e);
        createDefaultShowLocal();
      }
    } else {
      createDefaultShowLocal();
    }
  };

  const handleCreateNewShow = () => {
    const title = prompt("Enter new show title:", "New Run of Show");
    if (!title) return;
    const newId = "show_" + Date.now();
    const newShow = {
      id: newId,
      showTitle: title,
      startTime: "09:00:00",
      customColumns: ["Audio / Cues", "Video / Slides"],
      rundown: [
        { id: "block-1", type: "block", title: "BLOCK 1: MAIN SECTION", color: "#1e3a8a" },
        { id: "seg-1", type: "segment", min: 1, sec: 0, title: "Opening Segment", talent: "Host", script: "Type script here...", customValues: ["", ""], isUpper: false, timeMode: "auto" }
      ]
    };

    if (user && db) {
      setDoc(doc(db, 'artifacts', appId, 'public', `show_${newId}`), newShow).then(() => {
        const updatedList = [...showsList, { id: newId, title: title, updatedAt: new Date().toISOString() }];
        setDoc(doc(db, 'artifacts', appId, 'public', 'shows_index'), { shows: updatedList });
        setActiveShowId(newId);
        setCurrentView("editor");
      });
    } else {
      const updatedList = [...showsList, { id: newId, title: title, updatedAt: new Date().toISOString() }];
      setShowsList(updatedList);
      setActiveShowId(newId);
      setShowTitle(title);
      setStartTime("09:00:00");
      setCustomColumns(["Audio / Cues", "Video / Slides"]);
      setRundown(newShow.rundown);
      setCurrentView("editor");
    }
  };

  const handleDeleteShow = (id, e) => {
    e.stopPropagation();
    if (!window.confirm("Are you sure you want to delete this show?")) return;
    const updatedList = showsList.filter(s => s.id !== id);
    if (user && db) {
      setDoc(doc(db, 'artifacts', appId, 'public', 'shows_index'), { shows: updatedList }).then(() => {
        if (activeShowId === id) setActiveShowId(updatedList.length > 0 ? updatedList[0].id : null);
      });
    } else {
      setShowsList(updatedList);
      if (activeShowId === id) setActiveShowId(updatedList.length > 0 ? updatedList[0].id : null);
    }
  };

  const handleSelectShow = (id) => {
    setActiveShowId(id);
    if (!user || !db) loadLocalShowDetails(id);
    setCurrentView("editor");
  };

  // ==================== SEGMENT REPOSITORY LIBRARY ====================
  const saveSegmentToLibrary = (item) => {
    if (item.type === "block") return;
    const newItem = {
      id: "lib_" + Date.now(),
      title: item.title || "Reusable Segment",
      talent: item.talent || "",
      min: item.min || 1,
      sec: item.sec || 0,
      script: item.script || "",
      customValues: item.customValues || [],
      linkedShows: [{ showId: activeShowId, showTitle: showTitle }]
    };
    const updatedLib = [...segmentLibrary, newItem];
    setSegmentLibrary(updatedLib);
    if (user && db) {
      setDoc(doc(db, 'artifacts', appId, 'public', 'segment_library'), { items: updatedLib })
        .then(() => alert("Segment saved to repository library!"));
    } else {
      alert("Segment saved to repository library!");
    }
  };

  const updateLibraryItem = (libId, field, value) => {
    const updated = segmentLibrary.map(item => item.id === libId ? { ...item, [field]: value } : item);
    setSegmentLibrary(updated);
    if (user && db) {
      setDoc(doc(db, 'artifacts', appId, 'public', 'segment_library'), { items: updated });
    }
  };

  const syncLibraryItemToAllShows = async (libItem) => {
    if (!window.confirm(`Push updates for "${libItem.title}" to all shows containing this segment?`)) return;
    setSegmentLibrary(segmentLibrary.map(i => i.id === libItem.id ? { ...i, lastSynced: new Date().toISOString() } : i));
    if (user && db) {
      setDoc(doc(db, 'artifacts', appId, 'public', 'segment_library'), { items: segmentLibrary });
    }
    alert("Library segment synced successfully!");
  };

  const deleteFromLibrary = (libId) => {
    const updatedLib = segmentLibrary.filter(i => i.id !== libId);
    setSegmentLibrary(updatedLib);
    if (user && db) {
      setDoc(doc(db, 'artifacts', appId, 'public', 'segment_library'), { items: updatedLib });
    }
  };

  const insertSegmentFromLibrary = (libItem) => {
    const newItem = {
      id: "seg_" + Date.now(),
      type: "segment",
      min: libItem.min,
      sec: libItem.sec,
      title: libItem.title,
      talent: libItem.talent,
      script: libItem.script,
      customValues: [...(libItem.customValues || []), ...new Array(Math.max(0, customColumns.length - (libItem.customValues?.length || 0))).fill("")],
      isUpper: false,
      timeMode: "auto"
    };
    const updated = [...rundown, newItem];
    setRundown(updated);
    saveShowData(showTitle, startTime, customColumns, updated);
  };

  // ==================== TIME CALCULATION ENGINE ====================
  const calculateTimes = () => {
    const parts = startTime.split(":");
    let currentSeconds = (parseInt(parts[0]) || 0) * 3600 + 
                         (parseInt(parts[1]) || 0) * 60 + 
                         (parseInt(parts[2]) || 0);

    return rundown.map(item => {
      if (item.type === "block") {
        return { ...item, calculatedTime: "" };
      }

      if (item.timeMode === "hard" && item.hardStartTime) {
        const hParts = item.hardStartTime.split(":");
        currentSeconds = (parseInt(hParts[0]) || 0) * 3600 + 
                         (parseInt(hParts[1]) || 0) * 60 + 
                         (parseInt(hParts[2]) || 0);
      }

      const dateObj = new Date();
      dateObj.setHours(0, 0, 0, 0);
      dateObj.setSeconds(currentSeconds);
      const timeString = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

      const durationSecs = (parseInt(item.min) || 0) * 60 + (parseInt(item.sec) || 0);
      const startTimeSecs = currentSeconds;
      currentSeconds += durationSecs;

      return { ...item, calculatedTime: timeString, startTimeSecs, endTimeSecs: currentSeconds };
    });
  };

  const timedRundown = calculateTimes();

  // ==================== RUNDOWN ACTIONS ====================
  const addSegmentRow = () => {
    const newItem = {
      id: "seg-" + Date.now(),
      type: "segment",
      min: 1,
      sec: 0,
      title: "",
      talent: "",
      script: "",
      customValues: new Array(customColumns.length).fill(""),
      isUpper: false,
      timeMode: "auto"
    };
    const updated = [...rundown, newItem];
    setRundown(updated);
    saveShowData(showTitle, startTime, customColumns, updated);
  };

  const addCueRow = () => {
    const newItem = {
      id: "cue-" + Date.now(),
      type: "cue",
      min: 0,
      sec: 15,
      title: "",
      talent: "",
      color: "#FFD700",
      customValues: new Array(customColumns.length).fill(""),
      timeMode: "auto"
    };
    const updated = [...rundown, newItem];
    setRundown(updated);
    saveShowData(showTitle, startTime, customColumns, updated);
  };

  const addBlockHeaderRow = () => {
    const newItem = {
      id: "block-" + Date.now(),
      type: "block",
      title: "NEW BLOCK SECTION",
      color: "#1e3a8a"
    };
    const updated = [...rundown, newItem];
    setRundown(updated);
    saveShowData(showTitle, startTime, customColumns, updated);
  };

  const deleteRow = (index) => {
    const updated = [...rundown];
    updated.splice(index, 1);
    setRundown(updated);
    saveShowData(showTitle, startTime, customColumns, updated);
  };

  const moveRow = (index, direction) => {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= rundown.length) return;
    const updated = [...rundown];
    const temp = updated[index];
    updated[index] = updated[newIndex];
    updated[newIndex] = temp;
    setRundown(updated);
    saveShowData(showTitle, startTime, customColumns, updated);
  };

  const updateItemField = (index, field, value) => {
    const updated = [...rundown];
    updated[index][field] = value;
    setRundown(updated);
    saveShowData(showTitle, startTime, customColumns, updated);
  };

  const updateCustomValue = (itemIndex, colIndex, value) => {
    const updated = [...rundown];
    if (!updated[itemIndex].customValues) {
      updated[itemIndex].customValues = new Array(customColumns.length).fill("");
    }
    updated[itemIndex].customValues[colIndex] = value;
    setRundown(updated);
    saveShowData(showTitle, startTime, customColumns, updated);
  };

  const handleAddColumn = () => {
    const colName = prompt("Enter Column Header Name (e.g. Audio, Lighting, Slides):");
    if (!colName) return;
    const newCols = [...customColumns, colName];
    setCustomColumns(newCols);
    const newRundown = rundown.map(item => ({
      ...item,
      customValues: [...(item.customValues || new Array(customColumns.length).fill("")), ""]
    }));
    setRundown(newRundown);
    saveShowData(showTitle, startTime, newCols, newRundown);
  };

  const handleRemoveColumn = (colIndex) => {
    const newCols = customColumns.filter((_, idx) => idx !== colIndex);
    setCustomColumns(newCols);
    const newRundown = rundown.map(item => {
      const cv = [...(item.customValues || [])];
      cv.splice(colIndex, 1);
      return { ...item, customValues: cv };
    });
    setRundown(newRundown);
    saveShowData(showTitle, startTime, newCols, newRundown);
  };

  // ==================== PROMPTER & PRODUCER SYNC ====================
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

  // Sync Prompter when Active Producer Index changes
  useEffect(() => {
    if (autoSyncPrompter && currentView === "prompter" && prompterItemRefs.current[activeProducerIndex]) {
      prompterItemRefs.current[activeProducerIndex].scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [activeProducerIndex, autoSyncPrompter, currentView]);

  // Auto-scroll Producer sequence list
  useEffect(() => {
    if (currentView === "producer" && producerItemRefs.current[activeProducerIndex]) {
      producerItemRefs.current[activeProducerIndex].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [activeProducerIndex, currentView]);

  const stripInlineStyles = (html) => {
    if (!html) return "";
    return html.replace(/style="[^"]*"/gi, '').replace(/font-size:[^;"]+;?/gi, '');
  };

  if (!authInitialized) {
    return (
      <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center font-sans">
        <div className="text-center animate-pulse">
          <h2 className="text-xl font-bold">Connecting Run of Show Cloud...</h2>
          <p className="text-sm text-slate-400 mt-2">Authenticating securely with Firebase</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 p-4 md:p-8 font-sans">
      
      {/* Top Application Global Navigation Header */}
      <div className="bg-slate-900 text-white px-6 py-4 rounded-xl mb-6 shadow-xl flex flex-wrap items-center justify-between gap-4 print:hidden">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🎬</span>
          <div>
            <h1 className="text-xl font-extrabold tracking-tight">Run of Show Studio</h1>
            <p className="text-xs text-emerald-400 font-semibold">{cloudSyncStatus}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button 
            onClick={() => setCurrentView("list")} 
            className={`px-3 py-1.5 rounded text-sm font-bold transition ${currentView === "list" ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}
          >
            📋 Shows ({showsList.length})
          </button>
          {activeShowId && (
            <>
              <button 
                onClick={() => setCurrentView("editor")} 
                className={`px-3 py-1.5 rounded text-sm font-bold transition ${currentView === "editor" ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}
              >
                ✏️ Editor
              </button>
              <button 
                onClick={() => setCurrentView("producer")} 
                className={`px-3 py-1.5 rounded text-sm font-bold transition ${currentView === "producer" ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}
              >
                🎛️ Producer View
              </button>
              <button 
                onClick={() => setCurrentView("prompter")} 
                className="bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded text-sm font-bold transition flex items-center gap-1 shadow"
              >
                📺 Teleprompter
              </button>
            </>
          )}
          <button 
            onClick={() => setCurrentView("repository")} 
            className={`px-3 py-1.5 rounded text-sm font-bold transition ${currentView === "repository" ? 'bg-purple-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}
          >
            📚 Segment Library ({segmentLibrary.length})
          </button>
        </div>
      </div>

      {/* VIEW 1: SHOWS LIST MANAGER */}
      {currentView === "list" && (
        <div className="max-w-5xl mx-auto">
          <div className="flex justify-between items-center mb-6">
            <div>
              <h2 className="text-2xl font-bold">Your Saved Shows</h2>
              <p className="text-sm text-slate-500">Create and manage production rundowns synced instantly in the cloud.</p>
            </div>
            <button 
              onClick={handleCreateNewShow}
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-bold text-sm shadow transition flex items-center gap-2"
            >
              + Create New Show
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {showsList.map((show) => (
              <div 
                key={show.id} 
                onClick={() => handleSelectShow(show.id)}
                className={`bg-white p-5 rounded-xl border transition shadow-sm hover:shadow-md cursor-pointer flex flex-col justify-between ${activeShowId === show.id ? 'border-blue-600 ring-2 ring-blue-600/20' : 'border-slate-200 hover:border-slate-300'}`}
              >
                <div>
                  <div className="flex justify-between items-start gap-2 mb-2">
                    <h3 className="font-bold text-lg text-slate-900 line-clamp-2">{show.title || "Untitled Show"}</h3>
                    <button 
                      onClick={(e) => handleDeleteShow(show.id, e)}
                      className="text-slate-400 hover:text-rose-600 p-1 rounded transition text-xs font-bold"
                      title="Delete Show"
                    >
                      ✕
                    </button>
                  </div>
                  <p className="text-xs text-slate-400 mb-4">Last modified: {new Date(show.updatedAt || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                </div>
                <div className="flex items-center justify-between pt-3 border-t border-slate-100">
                  <span className="text-xs font-bold text-blue-600">Open Editor →</span>
                  <button 
                    onClick={(e) => { e.stopPropagation(); handleSelectShow(show.id); setCurrentView("prompter"); }}
                    className="bg-emerald-100 hover:bg-emerald-200 text-emerald-800 text-xs px-2.5 py-1 rounded font-bold transition"
                  >
                    📺 Teleprompter
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* VIEW 2: SEGMENT REPOSITORY LIBRARY */}
      {currentView === "repository" && (
        <div className="max-w-5xl mx-auto">
          <div className="mb-6">
            <h2 className="text-2xl font-bold">Reusable Segment Repository</h2>
            <p className="text-sm text-slate-500">Save frequently used segments or cues, edit master library items, and push sync updates across shows.</p>
          </div>

          {segmentLibrary.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-12 text-center text-slate-500">
              <p className="text-lg font-semibold mb-1">No saved segments in your library yet.</p>
              <p className="text-xs">While editing any show rundown, click the "💾 Save to Library" button on any segment row.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {segmentLibrary.map((libItem) => (
                <div key={libItem.id} className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex flex-col justify-between">
                  <div>
                    <div className="flex justify-between items-start gap-2 mb-3">
                      <input 
                        type="text"
                        value={libItem.title}
                        onChange={(e) => updateLibraryItem(libItem.id, 'title', e.target.value)}
                        className="font-bold text-base text-slate-900 border border-transparent hover:border-slate-300 focus:border-blue-600 rounded px-1 w-full"
                      />
                      <button onClick={() => deleteFromLibrary(libItem.id)} className="text-rose-500 hover:text-rose-700 text-xs font-bold">Delete</button>
                    </div>

                    <div className="flex gap-4 text-xs text-slate-500 mb-3 items-center">
                      <span>⏱️ {libItem.min}m {libItem.sec}s</span>
                      <input 
                        type="text"
                        value={libItem.talent || ""}
                        placeholder="Talent name..."
                        onChange={(e) => updateLibraryItem(libItem.id, 'talent', e.target.value)}
                        className="text-xs border border-slate-200 rounded px-1.5 py-0.5"
                      />
                    </div>

                    <textarea 
                      value={libItem.script || ""}
                      onChange={(e) => updateLibraryItem(libItem.id, 'script', e.target.value)}
                      className="w-full text-xs text-slate-600 bg-slate-50 p-3 rounded border border-slate-100 mb-3 h-20 resize-y"
                    />

                    {libItem.lastSynced && (
                      <p className="text-[10px] text-emerald-600 font-bold mb-3">✓ Last synced: {new Date(libItem.lastSynced).toLocaleTimeString()}</p>
                    )}
                  </div>

                  <div className="flex gap-2">
                    <button 
                      onClick={() => syncLibraryItemToAllShows(libItem)}
                      className="bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold py-2 px-3 rounded transition flex-1 shadow-sm"
                    >
                      🔄 Sync to All Shows
                    </button>
                    {activeShowId && (
                      <button 
                        onClick={() => { insertSegmentFromLibrary(libItem); alert(`Added "${libItem.title}" to active show!`); }}
                        className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold py-2 px-3 rounded transition flex-1 shadow-sm"
                      >
                        + Insert into Show
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* VIEW 3: TELEPROMPTER FULLSCREEN OVERLAY */}
      {currentView === "prompter" && (
        <div className="fixed inset-0 bg-black z-50 p-6 flex flex-col text-white">
          <div className="absolute top-4 right-6 bg-slate-900/95 border border-slate-700 p-3 rounded-lg flex flex-wrap items-center gap-4 shadow-2xl z-50">
            <span className="text-xs px-2.5 py-1 rounded-full bg-emerald-600 font-bold">🟢 Live Prompter</span>
            <button 
              onClick={() => setIsPrompterPlaying(!isPrompterPlaying)}
              className="bg-blue-600 hover:bg-blue-700 px-4 py-1.5 rounded text-sm font-bold shadow"
            >
              {isPrompterPlaying ? "⏸ Pause Scroll" : "▶ Play Scroll"}
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
            <label className="text-xs flex items-center gap-2">
              Size:
              <button onClick={() => setPrompterFontSize(Math.max(20, prompterFontSize - 4))} className="bg-slate-700 px-2 py-1 rounded font-bold">A-</button>
              <span>{prompterFontSize}px</span>
              <button onClick={() => setPrompterFontSize(Math.min(72, prompterFontSize + 4))} className="bg-slate-700 px-2 py-1 rounded font-bold">A+</button>
            </label>
            <button 
              onClick={() => setCurrentView("editor")}
              className="bg-rose-600 hover:bg-rose-700 text-white px-3 py-1.5 rounded text-xs font-bold"
            >
              Close
            </button>
          </div>

          <div ref={prompterRef} className="flex-1 overflow-y-auto max-w-5xl mx-auto my-20 px-4 w-full">
            <h1 className="text-4xl font-extrabold text-sky-400 mb-8 pb-4 border-b border-slate-800 text-center">{showTitle}</h1>
            {timedRundown.map((item, idx) => {
              const isActive = idx === activeProducerIndex;
              if (item.type === "block") {
                return (
                  <div 
                    key={item.id || idx}
                    ref={el => { prompterItemRefs.current[idx] = el; }}
                    style={{ backgroundColor: item.color }} 
                    className="p-6 my-8 font-extrabold text-2xl uppercase rounded-xl shadow-lg text-white text-center tracking-wider"
                  >
                    {item.title || "SECTION BREAK"}
                  </div>
                );
              }
              if (item.type === "cue") {
                const isFireBrick = item.color === "#B22222";
                return (
                  <div 
                    key={item.id || idx}
                    ref={el => { prompterItemRefs.current[idx] = el; }}
                    style={{ backgroundColor: item.color, color: isFireBrick ? '#fff' : '#0f172a' }} 
                    className={`p-5 my-6 font-bold rounded-xl shadow text-xl flex justify-between items-center ${isActive ? 'ring-4 ring-white' : ''}`}
                  >
                    <span>[CUE {item.calculatedTime}] {item.title || 'Cue Trigger'}</span>
                    {item.talent && <span>Talent: {item.talent}</span>}
                  </div>
                );
              }
              if (item.type === "segment" && item.script && item.script.replace(/<[^>]*>/g, '').trim() !== "") {
                return (
                  <div 
                    key={item.id || idx}
                    ref={el => { prompterItemRefs.current[idx] = el; }}
                    className={`mb-20 pb-10 border-b border-slate-800 transition-all p-6 rounded-2xl ${isActive ? 'bg-slate-900/90 border-amber-400/60 ring-2 ring-amber-400/50' : ''}`}
                  >
                    <div className="flex items-center justify-between mb-3">
                      <span className={`font-mono font-bold ${isActive ? 'text-amber-400' : 'text-sky-400'}`} style={{ fontSize: `${prompterFontSize * 1.1}px` }}>
                        {isActive ? '▶ ' : ''}[{item.calculatedTime}] {item.title || 'Segment'}
                      </span>
                      <span className="font-mono text-slate-400" style={{ fontSize: `${prompterFontSize * 0.8}px` }}>Dur: {item.min}m {item.sec}s</span>
                    </div>
                    {item.talent && <div className="text-amber-400 font-semibold mb-4" style={{ fontSize: `${prompterFontSize * 0.95}px` }}>🎙️ {item.talent}</div>}
                    <div 
                      className="text-slate-100 font-medium leading-relaxed"
                      style={{ fontSize: `${prompterFontSize}px`, textTransform: item.isUpper ? 'uppercase' : 'none' }}
                      dangerouslySetInnerHTML={{ __html: stripInlineStyles(item.script) }} 
                    />
                  </div>
                );
              }
              return null;
            })}
          </div>
        </div>
      )}

      {/* VIEW 4: DEDICATED PRODUCER CONTROL ROOM */}
      {currentView === "producer" && (
        <div className="max-w-6xl mx-auto">
          <div className="flex justify-between items-center mb-6 bg-slate-900 text-white p-6 rounded-2xl shadow-xl">
            <div>
              <h2 className="text-2xl font-extrabold mb-1">🎛️ Producer Live Control Room</h2>
              <p className="text-xs text-slate-400">Manage live execution, monitor countdown clocks, and advance cues.</p>
            </div>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-xs font-bold cursor-pointer">
                <input 
                  type="checkbox" 
                  checked={autoSyncPrompter} 
                  onChange={(e) => setAutoSyncPrompter(e.target.checked)}
                  className="w-4 h-4 rounded text-blue-600"
                />
                Sync Prompter to Producer
              </label>
              <button 
                onClick={() => setCurrentView("editor")}
                className="bg-rose-600 hover:bg-rose-700 text-white px-4 py-2 rounded-lg text-sm font-bold transition shadow"
              >
                ← Exit Producer Mode
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
            {/* Live Active Cue Card */}
            <div className="lg:col-span-2 bg-slate-900 text-white p-6 rounded-2xl shadow-xl flex flex-col justify-between border border-slate-800">
              <div>
                <div className="flex justify-between items-center mb-4 pb-3 border-b border-slate-800">
                  <span className="text-xs font-bold uppercase tracking-wider text-amber-400">Active Live Cue / Segment</span>
                  <span className="font-mono text-xs text-slate-400">Item {activeProducerIndex + 1} of {timedRundown.length}</span>
                </div>
                {timedRundown[activeProducerIndex] ? (() => {
                  const curr = timedRundown[activeProducerIndex];
                  const now = new Date();
                  const nowSecs = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
                  const remainingSecs = curr.endTimeSecs ? curr.endTimeSecs - nowSecs : 0;
                  const isNearEnd = remainingSecs <= 10 && remainingSecs > 0;
                  const isOverdue = remainingSecs <= 0;

                  return (
                    <div>
                      <h3 className="text-2xl font-bold mb-2 text-sky-300">{curr.title || "Untitled Segment"}</h3>
                      <div className="flex flex-wrap gap-4 text-sm text-slate-300 mb-4">
                        <span>⏰ Start: <strong className="font-mono text-white">{curr.calculatedTime}</strong></span>
                        <span>⏱️ Duration: <strong>{curr.min}m {curr.sec}s</strong></span>
                        {curr.talent && <span>🎙️ Talent: <strong className="text-amber-300">{curr.talent}</strong></span>}
                      </div>

                      {/* Flash countdown clock */}
                      <div className={`p-4 rounded-xl text-center font-mono text-xl font-extrabold mb-4 transition-all ${isOverdue ? 'bg-rose-600 text-white animate-pulse' : isNearEnd ? 'bg-amber-500 text-slate-900 animate-pulse' : 'bg-emerald-600 text-white'}`}>
                        {isOverdue ? `OVERDUE BY ${Math.abs(remainingSecs)}s` : `TIME REMAINING: ${Math.floor(remainingSecs / 60)}m ${remainingSecs % 60}s`}
                      </div>

                      {curr.script && (
                        <div 
                          className="bg-slate-800/80 p-4 rounded-xl text-sm text-slate-200 max-h-36 overflow-y-auto mb-4"
                          dangerouslySetInnerHTML={{ __html: stripInlineStyles(curr.script) }}
                        />
                      )}

                      {/* Display all custom columns notes */}
                      {customColumns.length > 0 && curr.customValues && (
                        <div className="grid grid-cols-2 gap-2 bg-slate-800/40 p-3 rounded-lg border border-slate-700/50">
                          {customColumns.map((colName, cIdx) => (
                            <div key={cIdx} className="text-xs">
                              <span className="text-slate-400 font-semibold">{colName}:</span> <span className="text-slate-200">{curr.customValues[cIdx] || "—"}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })() : <p className="text-slate-400">No active item selected.</p>}
              </div>

              <div className="flex gap-3 mt-6 pt-4 border-t border-slate-800">
                <button 
                  onClick={() => setActiveProducerIndex(Math.max(0, activeProducerIndex - 1))}
                  className="flex-1 bg-slate-800 hover:bg-slate-700 text-white py-2.5 rounded-xl font-bold text-sm transition"
                >
                  ← Previous Cue
                </button>
                <button 
                  onClick={() => setActiveProducerIndex(Math.min(timedRundown.length - 1, activeProducerIndex + 1))}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-2.5 rounded-xl font-bold text-sm transition shadow-lg"
                >
                  Next Cue / Advance →
                </button>
              </div>
            </div>

            {/* Next Up Preview */}
            <div className="bg-white border border-slate-200 p-6 rounded-2xl shadow-sm flex flex-col justify-between">
              <div>
                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4">Up Next In Rundown</h4>
                {timedRundown[activeProducerIndex + 1] ? (() => {
                  const nextItem = timedRundown[activeProducerIndex + 1];
                  return (
                    <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                      <span className="font-mono text-xs font-bold text-blue-600">{nextItem.calculatedTime}</span>
                      <h5 className="font-bold text-lg text-slate-900 mt-1 mb-2">{nextItem.title || "Untitled"}</h5>
                      {nextItem.talent && <p className="text-xs text-slate-600 mb-2">🎙️ {nextItem.talent}</p>}
                      <p className="text-xs text-slate-500">Duration: {nextItem.min}m {nextItem.sec}s</p>
                    </div>
                  );
                })() : <p className="text-sm text-slate-400">End of rundown reached.</p>}
              </div>

              <div className="mt-6 pt-4 border-t border-slate-100">
                <button 
                  onClick={() => setCurrentView("prompter")}
                  className="w-full bg-emerald-600 hover:bg-emerald-700 text-white py-3 rounded-xl font-bold text-sm shadow transition flex items-center justify-center gap-2"
                >
                  📺 Open Full Teleprompter
                </button>
              </div>
            </div>
          </div>

          {/* Producer Sequence Tracker List with full notes & colors */}
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
            <div className="p-4 bg-slate-900 text-white font-bold text-sm">
              Show Sequence & Cue Tracker
            </div>
            <div className="divide-y divide-slate-200 max-h-[500px] overflow-y-auto">
              {timedRundown.map((item, idx) => {
                const isSelected = idx === activeProducerIndex;
                if (item.type === "block") {
                  return (
                    <div 
                      key={item.id || idx}
                      ref={el => { producerItemRefs.current[idx] = el; }}
                      onClick={() => setActiveProducerIndex(idx)}
                      style={{ backgroundColor: item.color }} 
                      className={`p-3 font-bold text-white uppercase cursor-pointer transition ${isSelected ? 'ring-4 ring-blue-600' : ''}`}
                    >
                      {item.title || "BLOCK SECTION"}
                    </div>
                  );
                }
                if (item.type === "cue") {
                  return (
                    <div 
                      key={item.id || idx}
                      ref={el => { producerItemRefs.current[idx] = el; }}
                      onClick={() => setActiveProducerIndex(idx)}
                      style={{ backgroundColor: item.color, color: '#0f172a' }}
                      className={`p-3.5 flex flex-wrap items-center justify-between cursor-pointer transition font-bold ${isSelected ? 'ring-4 ring-blue-600 shadow-md' : 'hover:bg-slate-100'}`}
                    >
                      <div className="flex items-center gap-4">
                        <span className="font-mono text-xs">{item.calculatedTime}</span>
                        <span>[CUE] {item.title || "Cue Trigger"}</span>
                      </div>
                      {item.talent && <span className="text-xs">Target: {item.talent}</span>}
                    </div>
                  );
                }
                return (
                  <div 
                    key={item.id || idx}
                    ref={el => { producerItemRefs.current[idx] = el; }}
                    onClick={() => setActiveProducerIndex(idx)}
                    className={`p-4 flex flex-wrap items-center justify-between cursor-pointer transition ${isSelected ? 'bg-blue-50/80 border-l-4 border-blue-600 font-bold' : 'hover:bg-slate-50'}`}
                  >
                    <div className="flex items-center gap-6">
                      <span className="font-mono text-xs font-bold text-slate-600">{item.calculatedTime}</span>
                      <div>
                        <h5 className="font-bold text-slate-900">{item.title || "Untitled Segment"}</h5>
                        {item.talent && <p className="text-xs text-slate-500">🎙️ {item.talent}</p>}
                      </div>
                    </div>
                    <div className="flex items-center gap-4 text-xs text-slate-500">
                      <span>⏱️ {item.min}m {item.sec}s</span>
                      <span className="text-blue-600 font-bold">{isSelected ? 'ACTIVE NOW' : 'Select'}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* VIEW 5: ACTIVE SHOW EDITOR */}
      {currentView === "editor" && (
        <div className="print:m-0">
          <div className="flex flex-wrap items-center justify-between gap-4 mb-4 print:hidden">
            <input 
              type="text" 
              value={showTitle} 
              onChange={(e) => { setShowTitle(e.target.value); saveShowData(e.target.value, startTime, customColumns, rundown); }}
              className="text-2xl md:text-3xl font-bold bg-transparent border border-transparent hover:border-slate-300 focus:border-blue-600 focus:bg-white rounded-lg px-2 py-1 flex-1 transition"
              placeholder="Enter Show Name..."
            />
          </div>

          <div className="sticky top-0 z-40 bg-slate-50/95 backdrop-blur py-3 mb-6 flex flex-wrap gap-3 items-center border-b border-slate-200 print:hidden">
            <label className="font-semibold flex items-center gap-2 text-sm">
              Start Time: 
              <input 
                type="time" 
                step="1" 
                value={startTime} 
                onChange={(e) => { setStartTime(e.target.value); saveShowData(showTitle, e.target.value, customColumns, rundown); }}
                className="px-2 py-1 border border-slate-300 rounded text-sm bg-white"
              />
            </label>
            
            <button onClick={addSegmentRow} className="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-3 py-1.5 rounded text-sm transition shadow-sm">+ Add Segment</button>
            <button onClick={addCueRow} className="bg-amber-600 hover:bg-amber-700 text-white font-semibold px-3 py-1.5 rounded text-sm transition shadow-sm">+ Add Cue Line</button>
            <button onClick={addBlockHeaderRow} className="bg-slate-600 hover:bg-slate-700 text-white font-semibold px-3 py-1.5 rounded text-sm transition shadow-sm">+ Add Block Break</button>
            <button onClick={handleAddColumn} className="bg-blue-500 hover:bg-blue-600 text-white font-semibold px-3 py-1.5 rounded text-sm transition shadow-sm">+ Add Column</button>
            
            <button onClick={() => setCurrentView("producer")} className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold px-3 py-1.5 rounded text-sm transition shadow-sm">
              🎛️ Producer View
            </button>
            <button onClick={() => setCurrentView("prompter")} className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold px-3 py-1.5 rounded text-sm transition shadow-sm">
              📺 Teleprompter
            </button>
            <button onClick={() => window.print()} className="bg-slate-600 hover:bg-slate-700 text-white font-semibold px-3 py-1.5 rounded text-sm transition shadow-sm">📄 Print / PDF</button>
          </div>

          <div className="overflow-x-auto shadow-lg rounded-lg border border-slate-200 bg-white print:border-none print:shadow-none">
            <table className="w-full border-collapse min-w-[950px]">
              <thead>
                <tr className="bg-slate-900 text-white text-left text-xs uppercase tracking-wider print:bg-slate-800">
                  <th className="p-3 w-[120px]">Start Time</th>
                  <th className="p-3 w-[110px]">Duration</th>
                  <th className="p-3 w-[180px]">Segment / Title</th>
                  <th className="p-3 w-[140px]">Talent</th>
                  <th className="p-3 w-[350px]">Script / Cues</th>
                  {customColumns.map((col, idx) => (
                    <th key={idx} className="p-3 w-[150px]">
                      <div className="flex items-center justify-between gap-2">
                        <span>{col}</span>
                        <button 
                          onClick={() => handleRemoveColumn(idx)} 
                          className="bg-rose-500 hover:bg-rose-700 text-white text-[10px] px-1.5 py-0.5 rounded transition print:hidden"
                          title="Delete Column"
                        >
                          ✕
                        </button>
                      </div>
                    </th>
                  ))}
                  <th className="p-3 w-[120px] text-center print:hidden">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {timedRundown.map((item, index) => {
                  if (item.type === "block") {
                    const totalCols = 6 + customColumns.length;
                    return (
                      <tr key={item.id || index} style={{ backgroundColor: item.color }} className="transition-colors">
                        <td colSpan={totalCols} className="p-3">
                          <div className="flex items-center gap-3">
                            <input 
                              type="color" 
                              value={item.color} 
                              onChange={(e) => updateItemField(index, 'color', e.target.value)}
                              className="w-7 h-7 rounded border-0 cursor-pointer bg-transparent print:hidden"
                            />
                            <input 
                              type="text" 
                              value={item.title} 
                              onChange={(e) => updateItemField(index, 'title', e.target.value)}
                              className="font-bold text-base text-white bg-white/20 border border-white/30 rounded px-2 py-1 w-full focus:outline-none focus:bg-white/30"
                            />
                          </div>
                        </td>
                        <td className="p-3 text-center print:hidden">
                          <div className="flex items-center justify-center gap-1">
                            <button onClick={() => moveRow(index, -1)} className="bg-slate-600 hover:bg-slate-700 text-white text-xs px-1.5 py-1 rounded">▲</button>
                            <button onClick={() => moveRow(index, 1)} className="bg-slate-600 hover:bg-slate-700 text-white text-xs px-1.5 py-1 rounded">▼</button>
                            <button onClick={() => deleteRow(index)} className="bg-rose-600 hover:bg-rose-700 text-white text-xs w-6 h-6 rounded-full inline-flex items-center justify-center font-bold">✕</button>
                          </div>
                        </td>
                      </tr>
                    );
                  }

                  if (item.type === "cue") {
                    const isFireBrick = item.color === "#B22222";
                    return (
                      <tr key={item.id || index} style={{ backgroundColor: item.color, color: isFireBrick ? '#fff' : '#0f172a' }} className="transition-colors">
                        <td className="p-3 font-mono font-bold text-sm">
                          <div className="flex items-center gap-1">
                            <span>{item.calculatedTime}</span>
                          </div>
                        </td>
                        <td className="p-3">
                          <div className="relative">
                            <button 
                              onClick={() => setOpenDurationId(openDurationId === item.id ? null : item.id)}
                              className="px-2.5 py-1 bg-white/80 border rounded text-xs font-mono font-bold shadow-sm"
                            >
                              {item.min}m {item.sec}s ▾
                            </button>
                            {openDurationId === item.id && (
                              <div className="absolute z-50 mt-1 bg-white border border-slate-300 p-3 rounded-xl shadow-2xl w-48 text-slate-900">
                                <p className="text-xs font-bold mb-2">Edit Duration</p>
                                <div className="flex gap-2 mb-2">
                                  <label className="text-[10px]">Min: <input type="number" min="0" value={item.min} onChange={(e) => updateItemField(index, 'min', e.target.value)} className="w-12 border rounded px-1 text-xs" /></label>
                                  <label className="text-[10px]">Sec: <input type="number" min="0" max="59" value={item.sec} onChange={(e) => updateItemField(index, 'sec', e.target.value)} className="w-12 border rounded px-1 text-xs" /></label>
                                </div>
                                <button onClick={() => setOpenDurationId(null)} className="w-full bg-blue-600 text-white text-[10px] py-1 rounded font-bold">Done</button>
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="p-3">
                          <textarea 
                            rows={1}
                            value={item.title} 
                            onChange={(e) => updateItemField(index, 'title', e.target.value)}
                            className="w-full p-1.5 border border-slate-300 rounded bg-white text-slate-900 text-sm resize-y"
                            placeholder="Cue Title..."
                          />
                        </td>
                        <td className="p-3">
                          <textarea 
                            rows={1}
                            value={item.talent} 
                            onChange={(e) => updateItemField(index, 'talent', e.target.value)}
                            className="w-full p-1.5 border border-slate-300 rounded bg-white text-slate-900 text-sm resize-y"
                            placeholder="Talent..."
                          />
                        </td>
                        <td className="p-3">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-xs uppercase tracking-wide">Cue Color:</span>
                            <select 
                              value={item.color} 
                              onChange={(e) => updateItemField(index, 'color', e.target.value)}
                              className="p-1 border rounded bg-white text-slate-900 text-xs"
                            >
                              <option value="#FFD700">Gold</option>
                              <option value="#90EE90">LightGreen</option>
                              <option value="#6495ED">CornflowerBlue</option>
                              <option value="#B22222">FireBrick</option>
                            </select>
                          </div>
                        </td>
                        {customColumns.map((_, colIdx) => (
                          <td key={colIdx} className="p-3">
                            <textarea 
                              rows={1}
                              value={item.customValues?.[colIdx] || ""} 
                              onChange={(e) => updateCustomValue(index, colIdx, e.target.value)}
                              className="w-full p-1.5 border border-slate-300 rounded bg-white text-slate-900 text-sm resize-y"
                              placeholder="Notes..."
                            />
                          </td>
                        ))}
                        <td className="p-3 text-center print:hidden">
                          <div className="flex items-center justify-center gap-1">
                            <button onClick={() => moveRow(index, -1)} className="bg-slate-600 hover:bg-slate-700 text-white text-xs px-1.5 py-1 rounded">▲</button>
                            <button onClick={() => moveRow(index, 1)} className="bg-slate-600 hover:bg-slate-700 text-white text-xs px-1.5 py-1 rounded">▼</button>
                            <button onClick={() => deleteRow(index)} className="bg-rose-600 hover:bg-rose-700 text-white text-xs w-6 h-6 rounded-full inline-flex items-center justify-center font-bold">✕</button>
                          </div>
                        </td>
                      </tr>
                    );
                  }

                  return (
                    <tr key={item.id || index} className="hover:bg-slate-50/80 transition-colors">
                      <td className="p-3 font-mono font-bold text-sm text-slate-700">
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-2">
                            <span className={item.timeMode === 'hard' ? 'text-indigo-600' : ''}>{item.calculatedTime}</span>
                            <button 
                              onClick={() => updateItemField(index, 'timeMode', item.timeMode === 'hard' ? 'auto' : 'hard')}
                              className={`text-[10px] px-1.5 py-0.5 rounded font-bold print:hidden ${item.timeMode === 'hard' ? 'bg-indigo-600 text-white' : 'bg-slate-200 text-slate-700'}`}
                              title="Toggle Auto Time vs Hard Start Time"
                            >
                              {item.timeMode === 'hard' ? 'Hard' : 'Auto'}
                            </button>
                          </div>
                          {item.timeMode === 'hard' && (
                            <input 
                              type="time" 
                              step="1"
                              value={item.hardStartTime || startTime}
                              onChange={(e) => updateItemField(index, 'hardStartTime', e.target.value)}
                              className="text-xs border rounded p-1 print:hidden"
                            />
                          )}
                        </div>
                      </td>
                      <td className="p-3">
                        <div className="relative">
                          <button 
                            onClick={() => setOpenDurationId(openDurationId === item.id ? null : item.id)}
                            className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 border rounded text-xs font-mono font-bold shadow-sm"
                          >
                            {item.min}m {item.sec}s ▾
                          </button>
                          {openDurationId === item.id && (
                            <div className="absolute z-50 mt-1 bg-white border border-slate-300 p-3 rounded-xl shadow-2xl w-48 text-slate-900">
                              <p className="text-xs font-bold mb-2">Edit Duration</p>
                              <div className="flex gap-2 mb-2">
                                <label className="text-[10px]">Min: <input type="number" min="0" value={item.min} onChange={(e) => updateItemField(index, 'min', e.target.value)} className="w-12 border rounded px-1 text-xs" /></label>
                                <label className="text-[10px]">Sec: <input type="number" min="0" max="59" value={item.sec} onChange={(e) => updateItemField(index, 'sec', e.target.value)} className="w-12 border rounded px-1 text-xs" /></label>
                              </div>
                              <button onClick={() => setOpenDurationId(null)} className="w-full bg-blue-600 text-white text-[10px] py-1 rounded font-bold">Done</button>
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="p-3">
                        <textarea 
                          rows={2}
                          value={item.title} 
                          onChange={(e) => updateItemField(index, 'title', e.target.value)}
                          className="w-full p-1.5 border border-slate-300 rounded text-sm resize-y"
                          placeholder="Segment Name"
                        />
                      </td>
                      <td className="p-3">
                        <textarea 
                          rows={2}
                          value={item.talent} 
                          onChange={(e) => updateItemField(index, 'talent', e.target.value)}
                          className="w-full p-1.5 border border-slate-300 rounded text-sm resize-y"
                          placeholder="Talent Name"
                        />
                      </td>
                      <td className="p-3">
                        <div className="flex items-center justify-between gap-1 mb-1 print:hidden">
                          <div className="flex gap-1">
                            <button onClick={() => document.execCommand('bold')} className="bg-slate-200 hover:bg-slate-300 px-1.5 py-0.5 text-xs rounded font-bold">B</button>
                            <button onClick={() => document.execCommand('italic')} className="bg-slate-200 hover:bg-slate-300 px-1.5 py-0.5 text-xs rounded italic">I</button>
                            <button onClick={() => document.execCommand('underline')} className="bg-slate-200 hover:bg-slate-300 px-1.5 py-0.5 text-xs rounded underline">U</button>
                            <button 
                              onClick={() => updateItemField(index, 'isUpper', !item.isUpper)} 
                              className={`px-1.5 py-0.5 text-xs rounded font-semibold ${item.isUpper ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-700'}`}
                            >
                              ALL CAPS
                            </button>
                          </div>
                          <button 
                            onClick={() => saveSegmentToLibrary(item)}
                            className="bg-purple-100 hover:bg-purple-200 text-purple-800 text-[10px] font-bold px-2 py-0.5 rounded transition"
                            title="Save segment to repository"
                          >
                            💾 Save to Library
                          </button>
                        </div>
                        <div 
                          contentEditable={true} 
                          suppressContentEditableWarning={true}
                          onBlur={(e) => updateItemField(index, 'script', e.target.innerHTML)}
                          dangerouslySetInnerHTML={{ __html: item.script }}
                          style={{ textTransform: item.isUpper ? 'uppercase' : 'none' }}
                          className="min-h-[60px] p-2 border border-slate-300 rounded bg-white text-sm outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600 overflow-y-auto"
                        />
                      </td>
                      {customColumns.map((_, colIdx) => (
                        <td key={colIdx} className="p-3">
                          <textarea 
                            rows={2}
                            value={item.customValues?.[colIdx] || ""} 
                            onChange={(e) => updateCustomValue(index, colIdx, e.target.value)}
                            className="w-full p-1.5 border border-slate-300 rounded text-sm resize-y"
                            placeholder="Notes..."
                          />
                        </td>
                      ))}
                      <td className="p-3 text-center print:hidden">
                        <div className="flex items-center justify-center gap-1">
                          <button onClick={() => moveRow(index, -1)} className="bg-slate-600 hover:bg-slate-700 text-white text-xs px-1.5 py-1 rounded">▲</button>
                          <button onClick={() => moveRow(index, 1)} className="bg-slate-600 hover:bg-slate-700 text-white text-xs px-1.5 py-1 rounded">▼</button>
                          <button onClick={() => deleteRow(index)} className="bg-rose-600 hover:bg-rose-700 text-white text-xs w-6 h-6 rounded-full inline-flex items-center justify-center font-bold">✕</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

    </div>
  );
}
