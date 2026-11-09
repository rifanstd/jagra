package dev.jagra.sample

import android.app.Application
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import dev.jagra.sample.data.DataSource
import dev.jagra.sample.data.Item
import dev.jagra.sample.data.ItemRepository
import kotlinx.coroutines.launch

// A made-up account that only exists in this sample. The flows type it as plain text on purpose.
private const val DEMO_USERNAME = "demo"
private const val DEMO_PASSWORD = "jagra123"

data class StockState(
    val loading: Boolean = true,
    val items: List<Item> = emptyList(),
    val source: DataSource? = null,
)

enum class SaveState { Idle, Saving, Saved, Failed }

class StockViewModel(application: Application) : AndroidViewModel(application) {
    private val repository = ItemRepository(application.assets, BuildConfig.MOCK_SERVER_URL)

    var signedIn by mutableStateOf(false)
        private set
    var stock by mutableStateOf(StockState())
        private set
    var openItemId by mutableStateOf<Int?>(null)
        private set
    var saveState by mutableStateOf(SaveState.Idle)
        private set

    fun signIn(username: String, password: String): Boolean {
        if (username != DEMO_USERNAME || password != DEMO_PASSWORD) return false
        signedIn = true
        viewModelScope.launch {
            val (items, source) = repository.load()
            stock = StockState(loading = false, items = items, source = source)
        }
        return true
    }

    fun open(id: Int) {
        openItemId = id
        saveState = SaveState.Idle
    }

    fun close() {
        openItemId = null
    }

    fun edited() {
        saveState = SaveState.Idle
    }

    fun save(item: Item) {
        val source = stock.source ?: return
        saveState = SaveState.Saving
        viewModelScope.launch {
            if (repository.save(item, source)) {
                stock = stock.copy(items = stock.items.map { if (it.id == item.id) item else it })
                saveState = SaveState.Saved
            } else {
                saveState = SaveState.Failed
            }
        }
    }
}
