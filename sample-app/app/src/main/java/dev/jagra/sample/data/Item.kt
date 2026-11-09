package dev.jagra.sample.data

data class Item(
    val id: Int,
    val name: String,
    val quantity: Int,
    val description: String,
)

enum class DataSource { MockServer, BuiltIn }
