import React, { useState, useEffect, useRef } from 'react';
import './App.css';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || 'http://localhost:8001';

function App() {
  const [step, setStep] = useState('loading'); // loading, onboarding, main
  const [userId, setUserId] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [view, setView] = useState('home'); // home, history
  
  // Onboarding form
  const [formData, setFormData] = useState({
    name: '',
    age: '',
    gender: 'masculino',
    height: '',
    weight: '',
    activity_level: 'moderado',
    goal_weight: ''
  });
  
  // Camera & Analysis
  const [showCamera, setShowCamera] = useState(false);
  const [stream, setStream] = useState(null);
  const [capturedImage, setCapturedImage] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState(null);
  const [portionSize, setPortionSize] = useState(100);
  
  // Meals
  const [todayMeals, setTodayMeals] = useState([]);
  const [todayTotals, setTodayTotals] = useState(null);
  const [history, setHistory] = useState([]);
  
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const fileInputRef = useRef(null);
  
  // Load user on mount
  useEffect(() => {
    const storedUserId = localStorage.getItem('rafit_user_id');
    if (storedUserId) {
      setUserId(storedUserId);
      loadUserProfile(storedUserId);
    } else {
      // Criar novo usuário
      const newUserId = 'user_' + Date.now();
      localStorage.setItem('rafit_user_id', newUserId);
      setUserId(newUserId);
      setStep('onboarding');
    }
  }, []);
  
  const loadUserProfile = async (uid) => {
    try {
      const response = await fetch(`${BACKEND_URL}/api/user/profile/${uid}`);
      if (response.ok) {
        const profile = await response.json();
        setUserProfile(profile);
        setStep('main');
        loadTodayMeals(uid);
      } else {
        setStep('onboarding');
      }
    } catch (error) {
      console.error('Erro ao carregar perfil:', error);
      setStep('onboarding');
    }
  };
  
  const handleOnboardingSubmit = async (e) => {
    e.preventDefault();
    
    try {
      const response = await fetch(`${BACKEND_URL}/api/user/profile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: userId,
          ...formData,
          age: parseInt(formData.age),
          height: parseFloat(formData.height),
          weight: parseFloat(formData.weight),
          goal_weight: parseFloat(formData.goal_weight)
        })
      });
      
      if (response.ok) {
        const result = await response.json();
        await loadUserProfile(userId);
      } else {
        alert('Erro ao salvar perfil');
      }
    } catch (error) {
      console.error('Erro:', error);
      alert('Erro ao salvar perfil');
    }
  };
  
  const loadTodayMeals = async (uid) => {
    try {
      const today = new Date().toISOString().split('T')[0];
      const response = await fetch(`${BACKEND_URL}/api/meals/${uid}/${today}`);
      if (response.ok) {
        const data = await response.json();
        setTodayMeals(data.meals || []);
        setTodayTotals(data.totals || {});
      }
    } catch (error) {
      console.error('Erro ao carregar refeições:', error);
    }
  };
  
  const startCamera = async () => {
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: 1280, height: 720 }
      });
      setStream(mediaStream);
      setShowCamera(true);
      
      // Aguardar o próximo tick para garantir que o vídeo está no DOM
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = mediaStream;
        }
      }, 100);
    } catch (error) {
      console.error('Erro ao acessar câmera:', error);
      alert('Não foi possível acessar a câmera');
    }
  };
  
  const stopCamera = () => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
    }
    setShowCamera(false);
  };
  
  const capturePhoto = () => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0);
      
      const imageData = canvas.toDataURL('image/jpeg', 0.8);
      setCapturedImage(imageData);
      stopCamera();
    }
  };
  
  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        setCapturedImage(event.target.result);
      };
      reader.readAsDataURL(file);
    }
  };
  
  const analyzeFood = async () => {
    if (!capturedImage) return;
    
    setAnalyzing(true);
    try {
      // Extrair base64 puro (sem data:image/...;base64,)
      const base64Data = capturedImage.split(',')[1];
      
      const response = await fetch(`${BACKEND_URL}/api/food/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_base64: base64Data,
          user_id: userId
        })
      });
      
      if (response.ok) {
        const result = await response.json();
        setAnalysisResult(result);
        setPortionSize(result.portion_size || 100);
      } else {
        const error = await response.json();
        alert('Erro ao analisar: ' + (error.detail || 'Erro desconhecido'));
      }
    } catch (error) {
      console.error('Erro:', error);
      alert('Erro ao analisar alimento');
    } finally {
      setAnalyzing(false);
    }
  };
  
  const saveMeal = async () => {
    if (!analysisResult) return;
    
    try {
      const now = new Date();
      const today = now.toISOString().split('T')[0];
      const time = now.toTimeString().split(' ')[0].substring(0, 5);
      
      // Calcular valores ajustados pela porção
      const adjustmentFactor = portionSize / analysisResult.portion_size;
      
      const mealData = {
        meal_id: analysisResult.meal_id,
        user_id: userId,
        date: today,
        time: time,
        food_name: analysisResult.food_name,
        portion_size: portionSize,
        calories: Math.round(analysisResult.calories * adjustmentFactor),
        protein: Math.round(analysisResult.protein * adjustmentFactor * 10) / 10,
        carbs: Math.round(analysisResult.carbs * adjustmentFactor * 10) / 10,
        fats: Math.round(analysisResult.fats * adjustmentFactor * 10) / 10,
        image_base64: capturedImage.split(',')[1]
      };
      
      const response = await fetch(`${BACKEND_URL}/api/meal/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mealData)
      });
      
      if (response.ok) {
        // Resetar estado
        setCapturedImage(null);
        setAnalysisResult(null);
        setPortionSize(100);
        
        // Recarregar refeições do dia
        await loadTodayMeals(userId);
        
        alert('Refeição salva com sucesso!');
      } else {
        alert('Erro ao salvar refeição');
      }
    } catch (error) {
      console.error('Erro:', error);
      alert('Erro ao salvar refeição');
    }
  };
  
  const deleteMeal = async (mealId) => {
    if (!window.confirm('Deseja realmente deletar esta refeição?')) return;
    
    try {
      const response = await fetch(`${BACKEND_URL}/api/meal/${mealId}`, {
        method: 'DELETE'
      });
      
      if (response.ok) {
        await loadTodayMeals(userId);
      } else {
        alert('Erro ao deletar refeição');
      }
    } catch (error) {
      console.error('Erro:', error);
      alert('Erro ao deletar refeição');
    }
  };
  
  const loadHistory = async () => {
    try {
      const response = await fetch(`${BACKEND_URL}/api/meals/history/${userId}?days=7`);
      if (response.ok) {
        const data = await response.json();
        setHistory(data.history || []);
        setView('history');
      }
    } catch (error) {
      console.error('Erro ao carregar histórico:', error);
    }
  };
  
  // Render Loading
  if (step === 'loading') {
    return (
      <div className="loading-screen">
        <div className="loading-content">
          <h1 className="brand-display">RAFit</h1>
          <p className="body-medium">Carregando...</p>
        </div>
      </div>
    );
  }
  
  // Render Onboarding
  if (step === 'onboarding') {
    return (
      <div className="onboarding-screen">
        <div className="onboarding-content">
          <h1 className="heading-1">Bem-vindo ao RAFit</h1>
          <p className="body-large">Primeiro, vamos configurar seu perfil</p>
          
          <form onSubmit={handleOnboardingSubmit} className="onboarding-form">
            <div className="form-group">
              <label className="body-medium">Nome</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({...formData, name: e.target.value})}
                required
                className="form-input"
              />
            </div>
            
            <div className="form-row">
              <div className="form-group">
                <label className="body-medium">Idade</label>
                <input
                  type="number"
                  value={formData.age}
                  onChange={(e) => setFormData({...formData, age: e.target.value})}
                  required
                  className="form-input"
                />
              </div>
              
              <div className="form-group">
                <label className="body-medium">Sexo</label>
                <select
                  value={formData.gender}
                  onChange={(e) => setFormData({...formData, gender: e.target.value})}
                  className="form-input"
                >
                  <option value="masculino">Masculino</option>
                  <option value="feminino">Feminino</option>
                </select>
              </div>
            </div>
            
            <div className="form-row">
              <div className="form-group">
                <label className="body-medium">Altura (cm)</label>
                <input
                  type="number"
                  step="0.1"
                  value={formData.height}
                  onChange={(e) => setFormData({...formData, height: e.target.value})}
                  required
                  className="form-input"
                />
              </div>
              
              <div className="form-group">
                <label className="body-medium">Peso Atual (kg)</label>
                <input
                  type="number"
                  step="0.1"
                  value={formData.weight}
                  onChange={(e) => setFormData({...formData, weight: e.target.value})}
                  required
                  className="form-input"
                />
              </div>
            </div>
            
            <div className="form-group">
              <label className="body-medium">Peso Objetivo (kg)</label>
              <input
                type="number"
                step="0.1"
                value={formData.goal_weight}
                onChange={(e) => setFormData({...formData, goal_weight: e.target.value})}
                required
                className="form-input"
              />
            </div>
            
            <div className="form-group">
              <label className="body-medium">Nível de Atividade</label>
              <select
                value={formData.activity_level}
                onChange={(e) => setFormData({...formData, activity_level: e.target.value})}
                className="form-input"
              >
                <option value="sedentario">Sedentário (sem exercício)</option>
                <option value="leve">Leve (1-3x por semana)</option>
                <option value="moderado">Moderado (3-5x por semana)</option>
                <option value="intenso">Intenso (6-7x por semana)</option>
                <option value="muito_intenso">Muito Intenso (atleta)</option>
              </select>
            </div>
            
            <button type="submit" className="btn-primary">
              Começar
            </button>
          </form>
        </div>
      </div>
    );
  }
  
  // Render Main App
  return (
    <div className="app">
      {/* Header */}
      <header className="app-header">
        <h1 className="heading-3">RAFit</h1>
        <nav className="nav-tabs">
          <button 
            className={`nav-link ${view === 'home' ? 'active' : ''}`}
            onClick={() => setView('home')}
          >
            Hoje
          </button>
          <button 
            className={`nav-link ${view === 'history' ? 'active' : ''}`}
            onClick={() => loadHistory()}
          >
            Histórico
          </button>
        </nav>
      </header>
      
      {/* Main Content */}
      <main className="app-main">
        {view === 'home' && (
          <>
            {/* Daily Summary */}
            <section className="summary-card">
              <h2 className="heading-4">Resumo de Hoje</h2>
              <div className="calorie-progress">
                <div className="calorie-circle">
                  <div className="calorie-value">
                    <span className="heading-2">{todayTotals?.total_calories || 0}</span>
                    <span className="caption">/ {userProfile?.daily_calorie_goal || 0}</span>
                  </div>
                </div>
                <p className="body-small">calorias</p>
              </div>
              
              <div className="macros-grid">
                <div className="macro-item">
                  <span className="heading-4">{todayTotals?.total_protein?.toFixed(1) || 0}g</span>
                  <span className="caption">Proteína</span>
                </div>
                <div className="macro-item">
                  <span className="heading-4">{todayTotals?.total_carbs?.toFixed(1) || 0}g</span>
                  <span className="caption">Carboidratos</span>
                </div>
                <div className="macro-item">
                  <span className="heading-4">{todayTotals?.total_fats?.toFixed(1) || 0}g</span>
                  <span className="caption">Gorduras</span>
                </div>
              </div>
            </section>
            
            {/* Add Meal Section */}
            {!capturedImage && !analysisResult && (
              <section className="add-meal-section">
                <h3 className="heading-4">Adicionar Refeição</h3>
                <div className="button-group">
                  <button className="btn-primary" onClick={startCamera}>
                    📷 Tirar Foto
                  </button>
                  <button 
                    className="btn-secondary" 
                    onClick={() => fileInputRef.current?.click()}
                  >
                    📁 Enviar Foto
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleFileUpload}
                    style={{ display: 'none' }}
                  />
                </div>
              </section>
            )}
            
            {/* Camera View */}
            {showCamera && (
              <section className="camera-section">
                <video 
                  ref={videoRef} 
                  autoPlay 
                  playsInline
                  className="camera-video"
                />
                <canvas ref={canvasRef} style={{ display: 'none' }} />
                <div className="camera-controls">
                  <button className="btn-secondary" onClick={stopCamera}>
                    Cancelar
                  </button>
                  <button className="btn-primary" onClick={capturePhoto}>
                    Capturar
                  </button>
                </div>
              </section>
            )}
            
            {/* Image Preview & Analysis */}
            {capturedImage && !analysisResult && (
              <section className="preview-section">
                <img src={capturedImage} alt="Preview" className="preview-image" />
                <div className="button-group">
                  <button 
                    className="btn-secondary" 
                    onClick={() => setCapturedImage(null)}
                  >
                    Cancelar
                  </button>
                  <button 
                    className="btn-primary" 
                    onClick={analyzeFood}
                    disabled={analyzing}
                  >
                    {analyzing ? 'Analisando...' : 'Analisar Alimento'}
                  </button>
                </div>
              </section>
            )}
            
            {/* Analysis Result */}
            {analysisResult && (
              <section className="result-section">
                <div className="result-card">
                  <img src={capturedImage} alt="Food" className="result-image" />
                  <h3 className="heading-3">{analysisResult.food_name}</h3>
                  
                  <div className="portion-control">
                    <label className="body-medium">Porção (gramas)</label>
                    <input
                      type="number"
                      value={portionSize}
                      onChange={(e) => setPortionSize(parseFloat(e.target.value) || 0)}
                      className="form-input"
                    />
                  </div>
                  
                  <div className="nutrition-info">
                    <div className="nutrition-item">
                      <span className="heading-4">
                        {Math.round(analysisResult.calories * portionSize / analysisResult.portion_size)}
                      </span>
                      <span className="caption">Calorias</span>
                    </div>
                    <div className="nutrition-item">
                      <span className="heading-4">
                        {(analysisResult.protein * portionSize / analysisResult.portion_size).toFixed(1)}g
                      </span>
                      <span className="caption">Proteína</span>
                    </div>
                    <div className="nutrition-item">
                      <span className="heading-4">
                        {(analysisResult.carbs * portionSize / analysisResult.portion_size).toFixed(1)}g
                      </span>
                      <span className="caption">Carboidratos</span>
                    </div>
                    <div className="nutrition-item">
                      <span className="heading-4">
                        {(analysisResult.fats * portionSize / analysisResult.portion_size).toFixed(1)}g
                      </span>
                      <span className="caption">Gorduras</span>
                    </div>
                  </div>
                  
                  <div className="button-group">
                    <button 
                      className="btn-secondary" 
                      onClick={() => {
                        setCapturedImage(null);
                        setAnalysisResult(null);
                      }}
                    >
                      Cancelar
                    </button>
                    <button className="btn-primary" onClick={saveMeal}>
                      Salvar Refeição
                    </button>
                  </div>
                </div>
              </section>
            )}
            
            {/* Today's Meals */}
            <section className="meals-section">
              <h3 className="heading-4">Refeições de Hoje</h3>
              {todayMeals.length === 0 ? (
                <p className="body-medium" style={{textAlign: 'center', color: 'var(--text-muted)'}}>Nenhuma refeição registrada ainda</p>
              ) : (
                <div className="meals-list">
                  {todayMeals.map((meal) => (
                    <div key={meal.meal_id} className="meal-card">
                      {meal.image_base64 && (
                        <img 
                          src={`data:image/jpeg;base64,${meal.image_base64}`} 
                          alt={meal.food_name}
                          className="meal-thumbnail"
                        />
                      )}
                      <div className="meal-info">
                        <h4 className="heading-4">{meal.food_name}</h4>
                        <p className="body-small">{meal.time} • {meal.portion_size}g</p>
                        <p className="body-small">
                          {meal.calories} cal • {meal.protein}g P • {meal.carbs}g C • {meal.fats}g G
                        </p>
                      </div>
                      <button 
                        className="delete-btn"
                        onClick={() => deleteMeal(meal.meal_id)}
                      >
                        🗑️
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
        
        {view === 'history' && (
          <section className="history-section">
            <h2 className="heading-3">Histórico (7 dias)</h2>
            {history.length === 0 ? (
              <p className="body-medium" style={{textAlign: 'center', color: 'var(--text-muted)'}}>Sem histórico ainda</p>
            ) : (
              <div className="history-list">
                {history.map((day) => (
                  <div key={day.date} className="history-card">
                    <div className="history-header">
                      <h3 className="heading-4">{new Date(day.date).toLocaleDateString('pt-BR')}</h3>
                      <span className="heading-4">{Math.round(day.total_calories)} cal</span>
                    </div>
                    <div className="history-macros">
                      <span className="body-small">{day.total_protein.toFixed(1)}g P</span>
                      <span className="body-small">{day.total_carbs.toFixed(1)}g C</span>
                      <span className="body-small">{day.total_fats.toFixed(1)}g G</span>
                    </div>
                    <p className="caption">{day.meals.length} refeições</p>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}

export default App;