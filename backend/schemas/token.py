from pydantic import BaseModel

class Token(BaseModel):
    """
    Pydantic model for the OAuth2 token response.
    """
    access_token: str
    token_type: str
