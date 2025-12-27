from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, date
import os
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv
import base64
import uuid
import asyncio
from emergentintegrations.llm.chat import LlmChat, UserMessage, ImageContent

load_dotenv()

app = FastAPI()

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=[os.environ.get("CORS_ORIGINS", "*")],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# MongoDB
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "rafit_db")
client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]

# Collections
users_collection = db["users"]
meals_collection = db["meals"]

# Models
class UserProfile(BaseModel):
    user_id: str
    name: str
    age: int
    gender: str  # "masculino" ou "feminino"
    height: float  # cm
    weight: float  # kg
    activity_level: str  # sedentario, leve, moderado, intenso, muito_intenso
    goal_weight: float  # kg
    daily_calorie_goal: Optional[float] = None
    created_at: Optional[datetime] = None

class FoodAnalysisRequest(BaseModel):
    image_base64: str
    user_id: str

class MealEntry(BaseModel):
    meal_id: str
    user_id: str
    date: str
    time: str
    food_name: str
    portion_size: float  # gramas
    calories: float
    protein: float
    carbs: float
    fats: float
    image_base64: Optional[str] = None

class PortionAdjustment(BaseModel):
    meal_id: str
    new_portion_size: float

# Helper Functions
def calculate_bmr(weight: float, height: float, age: int, gender: str) -> float:
    """Calcula Taxa Metabólica Basal usando fórmula de Harris-Benedict"""
    if gender.lower() == "masculino":
        bmr = 88.362 + (13.397 * weight) + (4.799 * height) - (5.677 * age)
    else:  # feminino
        bmr = 447.593 + (9.247 * weight) + (3.098 * height) - (4.330 * age)
    return bmr

def calculate_tdee(bmr: float, activity_level: str) -> float:
    """Calcula Gasto Energético Diário Total"""
    activity_multipliers = {
        "sedentario": 1.2,
        "leve": 1.375,
        "moderado": 1.55,
        "intenso": 1.725,
        "muito_intenso": 1.9
    }
    return bmr * activity_multipliers.get(activity_level.lower(), 1.2)

def calculate_daily_calorie_goal(tdee: float, current_weight: float, goal_weight: float) -> float:
    """Calcula meta diária de calorias baseado no objetivo"""
    if goal_weight < current_weight:  # Perder peso
        return tdee - 500  # Déficit de 500 cal para perder ~0.5kg/semana
    elif goal_weight > current_weight:  # Ganhar peso
        return tdee + 300  # Superávit de 300 cal para ganhar ~0.3kg/semana
    else:  # Manter peso
        return tdee

async def analyze_food_with_ai(image_base64: str) -> dict:
    """Analisa imagem de comida usando Gemini 2.0 Flash"""
    try:
        api_key = os.environ.get("EMERGENT_LLM_KEY")
        if not api_key:
            raise ValueError("EMERGENT_LLM_KEY não configurada")
        
        # Criar sessão única para cada análise
        session_id = f"food_analysis_{uuid.uuid4()}"
        
        chat = LlmChat(
            api_key=api_key,
            session_id=session_id,
            system_message="""Você é um nutricionista especializado em análise de alimentos.
            Analise a imagem e retorne APENAS um JSON válido com a seguinte estrutura:
            {
              "food_name": "nome do alimento em português",
              "portion_size": valor_em_gramas,
              "calories": valor_numérico,
              "protein": valor_numérico,
              "carbs": valor_numérico,
              "fats": valor_numérico,
              "confidence": "alta/média/baixa"
            }
            Não adicione texto adicional, apenas o JSON."""
        ).with_model("gemini", "gemini-2.0-flash")
        
        # Criar mensagem com imagem
        image_content = ImageContent(image_base64=image_base64)
        user_message = UserMessage(
            text="Identifique o alimento nesta imagem e forneça as informações nutricionais estimadas em formato JSON.",
            file_contents=[image_content]
        )
        
        # Enviar e receber resposta
        response = await chat.send_message(user_message)
        
        # Parse da resposta
        import json
        import re
        
        print(f"Resposta bruta do Gemini (tipo: {type(response)}): {response}")
        
        # Se a resposta for uma lista, pegar o primeiro elemento
        if isinstance(response, list):
            response_text = response[0] if response else ""
        else:
            response_text = str(response)
        
        response_text = response_text.strip()
        
        # Remover markdown se presente
        if response_text.startswith("```"):
            response_text = re.sub(r'```json\s*|```\s*', '', response_text)
        
        print(f"Texto após processamento: {response_text}")
        
        # Parse JSON
        parsed_data = json.loads(response_text)
        
        # Se retornou uma lista, combinar os alimentos ou pegar o principal
        if isinstance(parsed_data, list):
            if len(parsed_data) > 0:
                # Pegar o primeiro item como principal
                food_data = parsed_data[0]
                # Se houver múltiplos, criar nome composto
                if len(parsed_data) > 1:
                    all_names = [item.get('food_name', '') for item in parsed_data]
                    food_data['food_name'] = ' + '.join(all_names)
                    # Somar valores nutricionais
                    food_data['portion_size'] = sum(item.get('portion_size', 0) for item in parsed_data)
                    food_data['calories'] = sum(item.get('calories', 0) for item in parsed_data)
                    food_data['protein'] = sum(item.get('protein', 0) for item in parsed_data)
                    food_data['carbs'] = sum(item.get('carbs', 0) for item in parsed_data)
                    food_data['fats'] = sum(item.get('fats', 0) for item in parsed_data)
            else:
                raise ValueError(\"Nenhum alimento identificado na resposta\")
        else:
            food_data = parsed_data
        
        return food_data
        
    except Exception as e:
        print(f"Erro na análise de alimento: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Erro ao analisar alimento: {str(e)}")

# API Endpoints
@app.get("/api/health")
async def health_check():
    return {"status": "healthy", "app": "RAFit"}

@app.post("/api/user/profile")
async def create_or_update_profile(profile: UserProfile):
    """Cria ou atualiza perfil do usuário"""
    try:
        # Calcular metas calóricas
        bmr = calculate_bmr(profile.weight, profile.height, profile.age, profile.gender)
        tdee = calculate_tdee(bmr, profile.activity_level)
        daily_goal = calculate_daily_calorie_goal(tdee, profile.weight, profile.goal_weight)
        
        profile_dict = profile.model_dump()
        profile_dict["daily_calorie_goal"] = round(daily_goal, 0)
        profile_dict["created_at"] = datetime.now()
        
        # Upsert no banco
        await users_collection.update_one(
            {"user_id": profile.user_id},
            {"$set": profile_dict},
            upsert=True
        )
        
        return {
            "message": "Perfil salvo com sucesso",
            "daily_calorie_goal": profile_dict["daily_calorie_goal"],
            "bmr": round(bmr, 0),
            "tdee": round(tdee, 0)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/user/profile/{user_id}")
async def get_profile(user_id: str):
    """Busca perfil do usuário"""
    profile = await users_collection.find_one({"user_id": user_id})
    if not profile:
        raise HTTPException(status_code=404, detail="Perfil não encontrado")
    
    # Remover _id do MongoDB
    profile.pop("_id", None)
    return profile

@app.post("/api/food/analyze")
async def analyze_food(request: FoodAnalysisRequest):
    """Analisa imagem de alimento e retorna informações nutricionais"""
    try:
        # Validar se usuário existe
        user = await users_collection.find_one({"user_id": request.user_id})
        if not user:
            raise HTTPException(status_code=404, detail="Usuário não encontrado")
        
        # Analisar comida com IA
        food_data = await analyze_food_with_ai(request.image_base64)
        
        # Criar ID único para a refeição
        meal_id = str(uuid.uuid4())
        
        # Preparar resposta
        result = {
            "meal_id": meal_id,
            "food_name": food_data.get("food_name", "Alimento não identificado"),
            "portion_size": food_data.get("portion_size", 100),
            "calories": food_data.get("calories", 0),
            "protein": food_data.get("protein", 0),
            "carbs": food_data.get("carbs", 0),
            "fats": food_data.get("fats", 0),
            "confidence": food_data.get("confidence", "média")
        }
        
        return result
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"Erro: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Erro ao processar imagem: {str(e)}")

@app.post("/api/meal/save")
async def save_meal(meal: MealEntry):
    """Salva refeição no histórico"""
    try:
        meal_dict = meal.model_dump()
        meal_dict["created_at"] = datetime.now()
        
        await meals_collection.insert_one(meal_dict)
        
        return {"message": "Refeição salva com sucesso", "meal_id": meal.meal_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/meal/adjust")
async def adjust_portion(adjustment: PortionAdjustment):
    """Ajusta porção de uma refeição e recalcula valores nutricionais"""
    try:
        meal = await meals_collection.find_one({"meal_id": adjustment.meal_id})
        if not meal:
            raise HTTPException(status_code=404, detail="Refeição não encontrada")
        
        # Calcular fator de ajuste
        original_portion = meal["portion_size"]
        adjustment_factor = adjustment.new_portion_size / original_portion
        
        # Recalcular valores
        updated_values = {
            "portion_size": adjustment.new_portion_size,
            "calories": round(meal["calories"] * adjustment_factor, 1),
            "protein": round(meal["protein"] * adjustment_factor, 1),
            "carbs": round(meal["carbs"] * adjustment_factor, 1),
            "fats": round(meal["fats"] * adjustment_factor, 1)
        }
        
        await meals_collection.update_one(
            {"meal_id": adjustment.meal_id},
            {"$set": updated_values}
        )
        
        return updated_values
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/meals/{user_id}/{date}")
async def get_meals_by_date(user_id: str, date: str):
    """Busca todas as refeições de um usuário em uma data específica"""
    try:
        meals = await meals_collection.find({
            "user_id": user_id,
            "date": date
        }).to_list(length=None)
        
        # Remover _id do MongoDB
        for meal in meals:
            meal.pop("_id", None)
        
        # Calcular totais do dia
        totals = {
            "total_calories": sum(m["calories"] for m in meals),
            "total_protein": sum(m["protein"] for m in meals),
            "total_carbs": sum(m["carbs"] for m in meals),
            "total_fats": sum(m["fats"] for m in meals),
            "meals_count": len(meals)
        }
        
        return {
            "meals": meals,
            "totals": totals
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/meals/history/{user_id}")
async def get_meal_history(user_id: str, days: int = 7):
    """Busca histórico de refeições dos últimos N dias"""
    try:
        from datetime import timedelta
        
        # Buscar últimos N dias
        meals = await meals_collection.find(
            {"user_id": user_id}
        ).sort("date", -1).limit(days * 10).to_list(length=None)
        
        # Agrupar por data
        history_by_date = {}
        for meal in meals:
            meal.pop("_id", None)
            meal_date = meal["date"]
            
            if meal_date not in history_by_date:
                history_by_date[meal_date] = {
                    "date": meal_date,
                    "meals": [],
                    "total_calories": 0,
                    "total_protein": 0,
                    "total_carbs": 0,
                    "total_fats": 0
                }
            
            history_by_date[meal_date]["meals"].append(meal)
            history_by_date[meal_date]["total_calories"] += meal["calories"]
            history_by_date[meal_date]["total_protein"] += meal["protein"]
            history_by_date[meal_date]["total_carbs"] += meal["carbs"]
            history_by_date[meal_date]["total_fats"] += meal["fats"]
        
        return {"history": list(history_by_date.values())}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/api/meal/{meal_id}")
async def delete_meal(meal_id: str):
    """Deleta uma refeição"""
    try:
        result = await meals_collection.delete_one({"meal_id": meal_id})
        if result.deleted_count == 0:
            raise HTTPException(status_code=404, detail="Refeição não encontrada")
        return {"message": "Refeição deletada com sucesso"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)